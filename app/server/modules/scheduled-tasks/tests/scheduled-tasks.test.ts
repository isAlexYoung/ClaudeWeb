import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scheduledTasksDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { formatRunTime, nextRunAfter, parseSchedule, zonedTime } from '@/modules/scheduled-tasks/schedule.js';
import {
  dispatchDueScheduledTasks,
  initializeScheduledTaskDispatcher,
  closeScheduledTaskDispatcher,
  runScheduledTaskNow,
} from '@/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.js';
import { scheduledTasksService } from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

async function withIsolatedDatabase(runTest: (userId: number, projectPath: string) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-tasks-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('scheduler', 'hash');
    await runTest(Number(user.id), tempDirectory);
  } finally {
    closeScheduledTaskDispatcher();
    chatRunRegistry.clearAll();
    connectedClients.clear();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

function createRuntime(runs: RunCall[], behaviour: 'ok' | 'throw' = 'ok') {
  return {
    hasRuntime: () => true,
    hasBackgroundWork: () => false,
    run: async (provider: string, command: string, options: Record<string, unknown>) => {
      if (behaviour === 'throw') throw new Error('provider exploded');
      runs.push({ provider, command, options });
    },
    abort: async () => true,
  } as never;
}

function taskBody(projectPath: string, overrides: Record<string, unknown> = {}) {
  return {
    name: 'Nightly check',
    projectPath,
    prompt: 'Run the tests and summarise failures.',
    schedule: { kind: 'daily', time: '09:00' },
    timezone: 'Asia/Shanghai',
    permission: 'edits',
    toolsSettings: { allowedTools: ['Bash(npm test)'], disallowedTools: [] },
    ...overrides,
  };
}

test('daily times are read in the task time zone', () => {
  // 2026-11-15 00:30 UTC is 08:30 in Shanghai, so 09:00 Shanghai is 01:00 UTC the same day.
  const next = nextRunAfter({ kind: 'daily', time: '09:00' }, 'Asia/Shanghai', new Date('2026-11-15T00:30:00Z'));
  assert.equal(next?.toISOString(), '2026-11-15T01:00:00.000Z');
  // Once 09:00 has passed, the next one is tomorrow.
  const after = nextRunAfter({ kind: 'daily', time: '09:00' }, 'Asia/Shanghai', new Date('2026-11-15T01:00:00Z'));
  assert.equal(after?.toISOString(), '2026-11-16T01:00:00.000Z');
});

test('a daily time keeps its wall-clock hour across a daylight-saving change', () => {
  // New York leaves daylight saving on 2026-11-01: 09:00 is 13:00 UTC before, 14:00 UTC after.
  const before = nextRunAfter({ kind: 'daily', time: '09:00' }, 'America/New_York', new Date('2026-10-31T12:00:00Z'));
  assert.equal(before?.toISOString(), '2026-10-31T13:00:00.000Z');
  const after = nextRunAfter({ kind: 'daily', time: '09:00' }, 'America/New_York', new Date('2026-10-31T14:00:00Z'));
  assert.equal(after?.toISOString(), '2026-11-01T14:00:00.000Z');
  assert.equal(zonedTime(2026, 7, 1, 9, 0, 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
});

test('weekly schedules skip days that are not picked', () => {
  // 2026-11-15 is a Sunday. Picking Monday and Friday at 08:00 UTC.
  const next = nextRunAfter({ kind: 'weekly', time: '08:00', days: [1, 5] }, 'UTC', new Date('2026-11-15T10:00:00Z'));
  assert.equal(next?.toISOString(), '2026-11-16T08:00:00.000Z');
  const following = nextRunAfter({ kind: 'weekly', time: '08:00', days: [1, 5] }, 'UTC', next as Date);
  assert.equal(following?.toISOString(), '2026-11-20T08:00:00.000Z');
});

test('intervals count from the given moment and one-off tasks end', () => {
  const now = new Date('2026-11-15T10:00:00Z');
  assert.equal(nextRunAfter({ kind: 'interval', hours: 6 }, 'UTC', now)?.toISOString(), '2026-11-15T16:00:00.000Z');
  assert.equal(nextRunAfter({ kind: 'once', at: '2026-11-15T09:00:00.000Z' }, 'UTC', now), null);
  assert.equal(formatRunTime(new Date('2026-11-15T01:05:00Z'), 'Asia/Shanghai'), '11-15 09:05');
});

test('schedules from the client are checked', () => {
  assert.throws(() => parseSchedule({ kind: 'daily', time: '25:00' }), /time of day/);
  assert.throws(() => parseSchedule({ kind: 'weekly', time: '08:00', days: [] }), /day of the week/);
  assert.throws(() => parseSchedule({ kind: 'interval', hours: 0 }), /whole number/);
  assert.throws(() => parseSchedule({ kind: 'cron' }), /Unknown/);
  assert.deepEqual(parseSchedule({ kind: 'weekly', time: '08:00', days: [5, 1, 1, 9] }), { kind: 'weekly', time: '08:00', days: [1, 5] });
});

test('a task is saved with its next run and validated', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const task = scheduledTasksService.create(userId, taskBody(projectPath), new Date('2026-11-15T00:30:00Z'));
    assert.equal(task.nextRunAt, '2026-11-15T01:00:00.000Z');
    assert.equal(task.enabled, true);
    assert.equal(task.permission, 'edits');

    assert.throws(() => scheduledTasksService.create(userId, taskBody(path.join(projectPath, 'missing'))), /no longer exists/);
    assert.throws(
      () => scheduledTasksService.create(userId, taskBody(projectPath, { schedule: { kind: 'once', at: '2020-01-01T00:00:00Z' } })),
      /already passed/,
    );

    // Pausing clears the next run and, sent without tool lists, keeps the saved ones;
    // resuming works the next run out again.
    const { toolsSettings: _omitted, ...withoutTools } = taskBody(projectPath, { enabled: false });
    const paused = scheduledTasksService.update(userId, task.id, withoutTools, new Date('2026-11-15T00:40:00Z'));
    assert.equal(paused.nextRunAt, null);
    assert.match(scheduledTasksDb.get(userId, task.id)?.tools_settings ?? '', /Bash\(npm test\)/);
    const resumed = scheduledTasksService.update(userId, task.id, taskBody(projectPath), new Date('2026-11-15T02:00:00Z'));
    assert.equal(resumed.nextRunAt, '2026-11-16T01:00:00.000Z');

    scheduledTasksService.remove(userId, task.id);
    assert.deepEqual(scheduledTasksService.list(userId), []);
  });
});

test('a due task starts a new unattended conversation in its project', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const runs: RunCall[] = [];
    const task = scheduledTasksService.create(userId, taskBody(projectPath), new Date('2026-11-15T00:30:00Z'));

    // The server was down at 09:00 and comes back two days later: the task runs once.
    const now = new Date('2026-11-17T03:00:00Z');
    assert.equal(await dispatchDueScheduledTasks(createRuntime(runs), now), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'Run the tests and summarise failures.');
    assert.equal(runs[0].options.unattended, true);
    assert.equal(runs[0].options.permissionMode, 'acceptEdits');
    assert.deepEqual((runs[0].options.toolsSettings as Record<string, unknown>).allowedTools, ['Bash(npm test)']);

    const saved = scheduledTasksService.get(userId, task.id);
    assert.equal(saved.nextRunAt, '2026-11-18T01:00:00.000Z');
    assert.equal(saved.runs.length, 1);
    assert.equal(saved.runs[0].status, 'succeeded');
    const session = sessionsDb.getSessionById(saved.runs[0].sessionId as string);
    assert.equal(session?.project_path, projectPath);
    assert.match(session?.custom_name ?? '', /^Nightly check · \d\d-\d\d \d\d:\d\d$/);

    // Nothing more is due at the same moment.
    assert.equal(await dispatchDueScheduledTasks(createRuntime(runs), now), 0);
  });
});

test('"allow everything" runs skip permissions and a failing run is recorded', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const runs: RunCall[] = [];
    const task = scheduledTasksService.create(
      userId,
      taskBody(projectPath, { permission: 'all', schedule: { kind: 'interval', hours: 1 } }),
      new Date('2026-11-15T00:00:00Z'),
    );
    await dispatchDueScheduledTasks(createRuntime(runs), new Date('2026-11-15T01:00:00Z'));
    assert.equal(runs[0].options.skipPermissions, true);

    await dispatchDueScheduledTasks(createRuntime(runs, 'throw'), new Date('2026-11-15T02:00:00Z'));
    const saved = scheduledTasksService.get(userId, task.id);
    assert.equal(saved.runs[0].status, 'failed');
    assert.match(saved.runs[0].error ?? '', /provider exploded/);
  });
});

test('a one-off task switches itself off after running', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const runs: RunCall[] = [];
    const task = scheduledTasksService.create(
      userId,
      taskBody(projectPath, { schedule: { kind: 'once', at: '2026-11-15T05:00:00Z' } }),
      new Date('2026-11-15T00:00:00Z'),
    );
    await dispatchDueScheduledTasks(createRuntime(runs), new Date('2026-11-15T05:00:30Z'));
    const saved = scheduledTasksService.get(userId, task.id);
    assert.equal(runs.length, 1);
    assert.equal(saved.enabled, false);
    assert.equal(saved.nextRunAt, null);
  });
});

test('run now queues a run, refuses a second one meanwhile, and restarts fail stale runs', async () => {
  await withIsolatedDatabase(async (userId, projectPath) => {
    const runs: RunCall[] = [];
    const task = scheduledTasksService.create(userId, taskBody(projectPath, { enabled: false }), new Date());
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const slowRuntime = {
      ...(createRuntime(runs) as object),
      run: async (provider: string, command: string, options: Record<string, unknown>) => {
        runs.push({ provider, command, options });
        await blocked;
      },
    } as never;

    runScheduledTaskNow(userId, task.id, slowRuntime);
    assert.throws(() => runScheduledTaskNow(userId, task.id, slowRuntime), /already running/);
    release();
    for (let attempt = 0; attempt < 100 && scheduledTasksService.get(userId, task.id).runs[0]?.status !== 'succeeded'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const saved = scheduledTasksService.get(userId, task.id);
    assert.equal(saved.runs[0].source, 'manual');
    assert.equal(saved.runs[0].status, 'succeeded');

    // A run left behind by a stopped server is marked failed when the dispatcher starts.
    const stale = scheduledTasksDb.createRun(task.id, 'schedule', new Date());
    initializeScheduledTaskDispatcher(createRuntime(runs));
    const after = scheduledTasksService.get(userId, task.id).runs.find((run) => run.id === stale.id);
    assert.equal(after?.status, 'failed');
    assert.match(after?.error ?? '', /restarted/);
  });
});

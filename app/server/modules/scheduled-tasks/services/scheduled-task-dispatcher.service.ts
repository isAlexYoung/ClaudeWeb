import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

import { scheduledTasksDb, sessionsDb } from '@/modules/database/index.js';
import type { ScheduledTaskRow } from '@/modules/database/index.js';
import { formatRunTime, nextRunAfter, readSchedule } from '@/modules/scheduled-tasks/schedule.js';
import { announceScheduledTasksChanged } from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
import { runDetachedChatTurn } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { AppError } from '@/shared/utils.js';

/** Due tasks are looked for this often; schedules are set to the minute. */
const POLL_INTERVAL_MS = 30_000;
/** A run still going after this long is stopped, so one stuck run cannot hold up every later one. */
export const RUN_TIMEOUT_MS = 2 * 60 * 60 * 1000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let dispatcherRuntime: ProviderRuntimeGateway | null = null;
// Runs go one at a time: each waits for the previous one to finish, so a busy
// schedule cannot spend the account's usage limit on several runs at once.
let queue: Promise<void> = Promise.resolve();

function readToolsSettings(raw: string): { allowedTools: string[]; disallowedTools: string[] } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const list = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
    return { allowedTools: list(parsed.allowedTools), disallowedTools: list(parsed.disallowedTools) };
  } catch {
    return { allowedTools: [], disallowedTools: [] };
  }
}

/**
 * What a run is sent with. Nobody is watching a scheduled run, so `unattended`
 * makes the Claude runtime refuse anything that would wait for an answer
 * instead of leaving the run hanging. "edits" lets file edits through
 * (acceptEdits) and refuses the rest unless the user's allow list covers it;
 * "all" allows every tool.
 */
export function buildRunOptions(task: ScheduledTaskRow, title: string): Record<string, unknown> {
  const tools = readToolsSettings(task.tools_settings);
  const skipPermissions = task.permission === 'all';
  return {
    ...(task.model ? { model: task.model } : {}),
    permissionMode: skipPermissions ? 'default' : 'acceptEdits',
    toolsSettings: { ...tools, skipPermissions },
    skipPermissions,
    unattended: true,
    sessionSummary: title,
  };
}

async function withTimeout<T>(work: Promise<T>, onTimeout: () => Promise<unknown>): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), RUN_TIMEOUT_MS);
    timer.unref?.();
  });
  const result = await Promise.race([work, timeout]);
  if (timer) clearTimeout(timer);
  if (result === 'timeout') await onTimeout().catch(() => undefined);
  return result;
}

/** Starts one run: a new conversation in the task's project with the task's prompt. */
async function executeRun(taskId: string, runId: string, runtime: ProviderRuntimeGateway): Promise<void> {
  const task = scheduledTasksDb.getById(taskId);
  if (!task) {
    scheduledTasksDb.finishRun(runId, 'The task was deleted before it ran.', new Date());
    return;
  }

  let error: string | null = null;
  try {
    if (!fs.existsSync(task.project_path)) {
      throw new Error(`The project folder ${task.project_path} no longer exists.`);
    }
    const startedAt = new Date();
    const title = `${task.name} · ${formatRunTime(startedAt, task.timezone)}`;
    const sessionId = randomUUID();
    sessionsDb.createAppSession(sessionId, 'claude', task.project_path, title);
    scheduledTasksDb.startRun(runId, sessionId, startedAt);
    announceScheduledTasksChanged();

    const result = await withTimeout(
      runDetachedChatTurn(
        { sessionId, userId: task.user_id, content: task.prompt, options: buildRunOptions(task, title) },
        { runtime },
      ),
      () => runtime.abort('claude', sessionId),
    );
    if (result === 'timeout') error = 'Stopped after running for 2 hours.';
    else if (!result.started || result.error) error = result.error ?? 'The run did not start.';
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  scheduledTasksDb.finishRun(runId, error, new Date());
  if (error) console.error('[ScheduledTasks] Run failed', { taskId, error });
  announceScheduledTasksChanged();
}

function enqueue(taskId: string, runId: string, runtime: ProviderRuntimeGateway): Promise<void> {
  const next = queue.then(() => executeRun(taskId, runId, runtime));
  queue = next.catch((error: unknown) => {
    console.error('[ScheduledTasks] Run crashed', { taskId, error: error instanceof Error ? error.message : String(error) });
  });
  return next;
}

/**
 * Queues every task whose time has come. A run missed while the server was
 * down is run once, not once per missed occurrence: the next time is counted
 * from now. Exported so a test can drive one pass and wait for its runs.
 */
export async function dispatchDueScheduledTasks(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  const due = scheduledTasksDb.claimDue(now, (row) => {
    const schedule = readSchedule(row.schedule);
    return schedule ? nextRunAfter(schedule, row.timezone, now) : null;
  });
  const runs: Promise<void>[] = [];
  for (const row of due) {
    // A run of this task is still going: this occurrence is skipped rather
    // than stacked behind it.
    if (scheduledTasksDb.hasActiveRun(row.id)) continue;
    const run = scheduledTasksDb.createRun(row.id, 'schedule', now);
    runs.push(enqueue(row.id, run.id, runtime));
  }
  if (due.length > 0) announceScheduledTasksChanged();
  await Promise.all(runs);
  return runs.length;
}

/** "Run now": queues a run outside the schedule, which keeps its next time. */
export function runScheduledTaskNow(userId: number, taskId: string, runtime = dispatcherRuntime): { queued: true } {
  if (!runtime) throw new AppError('Chat runtime is unavailable.', { code: 'RUNTIME_UNAVAILABLE', statusCode: 503 });
  const task = scheduledTasksDb.get(userId, taskId);
  if (!task) throw new AppError('The scheduled task was not found.', { code: 'SCHEDULED_TASK_NOT_FOUND', statusCode: 404 });
  if (scheduledTasksDb.hasActiveRun(taskId)) {
    throw new AppError('This task is already running.', { code: 'SCHEDULED_TASK_RUNNING', statusCode: 409 });
  }
  const now = new Date();
  scheduledTasksDb.markManualRun(taskId, now);
  const run = scheduledTasksDb.createRun(taskId, 'manual', now);
  void enqueue(taskId, run.id, runtime);
  announceScheduledTasksChanged();
  return { queued: true };
}

/** Starts the poll. Runs left unfinished by a previous server process are marked failed first. */
export function initializeScheduledTaskDispatcher(runtime: ProviderRuntimeGateway): void {
  dispatcherRuntime = runtime;
  if (pollTimer) return;

  scheduledTasksDb.failInterruptedRuns('ClaudeWeb restarted before this run finished.', new Date());

  const poll = () => {
    if (pollInFlight) return;
    pollInFlight = true;
    // Not awaited past the claim: the runs finish in the queue, and the next
    // poll may claim other tasks meanwhile.
    try {
      void dispatchDueScheduledTasks(runtime).catch((error: unknown) => {
        console.error('[ScheduledTasks] Dispatch pass failed', { error: error instanceof Error ? error.message : String(error) });
      });
    } catch (error) {
      console.error('[ScheduledTasks] Dispatch pass failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      pollInFlight = false;
    }
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  pollTimer.unref?.();
  poll();
}

export function closeScheduledTaskDispatcher(): void {
  dispatcherRuntime = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

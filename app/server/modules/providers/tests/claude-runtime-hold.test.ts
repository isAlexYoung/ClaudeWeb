import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { ClaudeSessionsProvider } from '@/modules/providers/list/claude/claude-sessions.provider.js';
import { CLAUDE_PREDEFINED_MODELS } from '@/modules/providers/list/claude/claude-models.provider.js';
import {
  abortClaudeSDKSession,
  listClaudeSDKBackgroundWork,
  queryClaudeSDK,
  stopClaudeSDKTask,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { NormalizedMessage, ProviderRuntimeContext } from '@/shared/types.js';

/**
 * The runtime keeps the CLI's stdin open after a turn's `result` while the
 * turn's background work is outstanding, and lets go when that work has
 * reported. These drive `queryClaudeSDK` with a scripted SDK stream — the
 * seam is `context.createQuery` — and watch the held prompt stream: the CLI
 * exits when it ends, so "released" is the whole outcome.
 */

// A retired process is closed after this grace; short, so the tests see it.
process.env.CLAUDE_RETIRE_GRACE_MS = '60';

// The runtime's timers are unref'd so they never keep a process alive; in the
// server the HTTP listener does. Here nothing else would, and on Linux the test
// process ended in the middle of a stop that was waiting on one of them.
const keepAlive = setInterval(() => {}, 1000);
after(() => clearInterval(keepAlive));

const SESSION_ID = 'app-hold-session';
const NATIVE_ID = 'native-hold-session';

type Scripted = {
  emit: (message: Record<string, unknown>) => void;
  end: () => void;
  released: () => boolean;
  closed: () => boolean;
  /** Whether the runtime has started this CLI (called createQuery) yet. */
  created: () => boolean;
  stopped: string[];
};

/** How a scripted CLI misbehaves: never answering an interrupt, or living on after close. */
type Behaviour = { interruptNeverAnswers?: boolean; ignoresClose?: boolean };

/** A stand-in for the SDK query: yields what the test emits, and reads the held prompt to notice its release. */
function createScriptedQuery(
  behaviour: Behaviour = {},
): { createQuery: NonNullable<ProviderRuntimeContext['createQuery']>; script: Scripted } {
  const queue: Array<Record<string, unknown> | null> = [];
  let wake: (() => void) | null = null;
  let released = false;
  let closed = false;
  let created = false;
  const stopped: string[] = [];

  const script: Scripted = {
    emit: (message) => { queue.push(message); wake?.(); },
    end: () => { queue.push(null); wake?.(); },
    released: () => released,
    closed: () => closed,
    created: () => created,
    stopped,
  };

  const createQuery: NonNullable<ProviderRuntimeContext['createQuery']> = ({ prompt }) => {
    created = true;
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
      released = true;
    })();

    const iterator = (async function* () {
      for (;;) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { wake = resolve; });
          wake = null;
          continue;
        }
        const next = queue.shift();
        if (next === null || next === undefined) {
          return;
        }
        yield next;
      }
    })();

    return Object.assign(iterator, {
      interrupt: () => (behaviour.interruptNeverAnswers ? new Promise<void>(() => {}) : Promise.resolve()),
      stopTask: async (taskId: string) => { stopped.push(taskId); },
      // Like the SDK: the process is gone and the stream ends — unless this
      // CLI is one that lives on regardless.
      close: () => {
        closed = true;
        if (!behaviour.ignoresClose) {
          queue.push(null);
          wake?.();
        }
      },
    });
  };

  return { createQuery, script };
}

async function withRun(
  runTest: (context: { script: Scripted; sent: NormalizedMessage[]; done: Promise<unknown> }) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const { createQuery, script } = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: ProviderRuntimeContext = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
    createQuery,
  };

  try {
    const done = queryClaudeSDK('hello', { sessionId: SESSION_ID, cwd }, writer as never, context);
    await runTest({ script, sent, done });
    script.end();
    await done;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const settle = () => new Promise((resolve) => { setTimeout(resolve, 25); });

// A fixed settle can be too short on a loaded machine; the supersede tests
// wait for the run to have actually processed its turn instead.
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !condition(); attempt += 1) {
    await settle();
  }
  assert.ok(condition(), 'condition never became true');
}

const init = () => ({ type: 'system', subtype: 'init', session_id: NATIVE_ID });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
});
const ack = (id: string, text: string, toolUseResult: Record<string, unknown>) => ({
  type: 'user', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
  tool_use_result: toolUseResult,
});
const taskStarted = (taskId: string, toolUseId: string, taskType: string) => ({
  type: 'system', subtype: 'task_started', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, description: `Task ${taskId}`, task_type: taskType,
});
const taskNotification = (taskId: string, toolUseId: string, status: string) => ({
  type: 'system', subtype: 'task_notification', session_id: NATIVE_ID, task_id: taskId, tool_use_id: toolUseId, status, summary: `Task ${taskId} ${status}`, output_file: '',
});
const result = () => ({ type: 'result', subtype: 'success', session_id: NATIVE_ID, result: 'launched', duration_ms: 1, num_turns: 1 });

test('stopping the last outstanding task releases the held process', async () => {
  await withRun(async ({ script, sent, done }) => {
    script.emit(init());
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf', 'local_workflow'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await waitFor(() => sent.some(message => message.kind === 'complete'));

    // The turn is over for the client, the process is held for the workflow.
    assert.ok(sent.some((message) => message.kind === 'complete'));
    assert.deepEqual(listClaudeSDKBackgroundWork().map((entry) => [entry.sessionId, entry.tasks.map((task) => task.taskId)]), [[SESSION_ID, ['wf1']]]);
    assert.equal(script.released(), false, 'stdin stays open while the workflow runs');

    // The user stops it. The CLI answers with a `stopped` notification and
    // pushes no follow-up turn, so nothing else would ever end the hold.
    assert.equal(await stopClaudeSDKTask(SESSION_ID, 'wf1'), true);
    assert.deepEqual(script.stopped, ['wf1']);
    script.emit(taskNotification('wf1', 'toolu_wf', 'stopped'));
    await waitFor(script.released);

    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
    assert.equal(script.released(), true, 'the process is let go once nothing is outstanding');
    void done;
  });
});

test('a task that reported completed keeps the hold for the turn that relays its result', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(toolUse('toolu_wf', 'Workflow', { script: 'export const meta = {}' }));
    script.emit(taskStarted('wf1', 'toolu_wf', 'local_workflow'));
    script.emit(ack('toolu_wf', 'Workflow launched in background. Task ID: wf1', { status: 'async_launched', taskId: 'wf1', taskType: 'local_workflow' }));
    script.emit(result());
    await settle();

    // Completed, unlike stopped, is followed by a turn the CLI pushes to relay
    // the result; closing stdin at the notification would cut it short.
    script.emit(taskNotification('wf1', 'toolu_wf', 'completed'));
    await settle();
    assert.equal(script.released(), false);

    script.emit(result());
    await settle();
    assert.equal(script.released(), true, 'the follow-up turn\'s result ends the hold');
  });
});

test('an agent that ran in the foreground and settled before the result does not hold the process', async () => {
  await withRun(async ({ script }) => {
    // An Agent call without `run_in_background` is scored as background by
    // the static rule, but the CLI ran it in the foreground: its task started
    // and settled before the turn ended. The task events know that.
    script.emit(init());
    script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'Return the word FOUR', subagent_type: 'general-purpose' }));
    script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    script.emit(taskNotification('a1', 'toolu_agent', 'completed'));
    script.emit(ack('toolu_agent', 'FOUR', { status: 'completed', agentId: 'a1' }));
    script.emit(result());
    await waitFor(script.released);

    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
    assert.equal(script.released(), true, 'nothing is outstanding, so nothing to hold for');
  });
});

test('a new turn stops the tasks the held process still has going before letting it go', async () => {
  // Two runs on one session, each with its own scripted CLI: the first is
  // held for a background agent, the second is the user's next message.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const first = createScriptedQuery();
  const second = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: Omit<ProviderRuntimeContext, 'createQuery'> = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };

  try {
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: first.createQuery });
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    first.script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(first.script.released(), false, 'the first process is held for its agent');

    // Closing stdin alone would leave the CLI waiting for the agent, so the
    // superseded process would live on next to the new one for as long as
    // the agent runs. The stop has to reach it before stdin ends, because the
    // SDK drops control requests written to an ended stdin.
    const secondRun = queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: second.createQuery });
    await settle();
    assert.deepEqual(first.script.stopped, ['a1'], 'the held process is told to stop its agent');
    assert.equal(first.script.released(), true, 'and is then let go');
    assert.deepEqual(second.script.stopped, [], 'the new process is untouched');

    first.script.emit(taskNotification('a1', 'toolu_agent', 'stopped'));
    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a held process is still let go when stopping its tasks throws', async () => {
  // Stopping is best effort; a stop that throws on the spot must not keep the
  // held process alive or take the new turn down with it.
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const first = createScriptedQuery();
  const second = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: Omit<ProviderRuntimeContext, 'createQuery'> = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, sessionId) => sessions.normalizeMessage(raw, sessionId),
    isProviderInstalled: async () => true,
  };
  const throwingStop: NonNullable<ProviderRuntimeContext['createQuery']> = (options) =>
    Object.assign(first.createQuery(options), {
      stopTask: () => { throw new Error('stop failed'); },
    });

  try {
    const firstRun = queryClaudeSDK('start an agent', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: throwingStop });
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'sleep 90', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    first.script.emit(ack('toolu_agent', 'Async agent launched successfully.', { status: 'async_launched', agentId: 'a1' }));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(first.script.released(), false, 'the first process is held for its agent');

    const secondRun = queryClaudeSDK('Continue', { sessionId: SESSION_ID, cwd }, writer as never, { ...context, createQuery: second.createQuery });
    await settle();
    assert.equal(first.script.released(), true, 'the held process is let go anyway');

    first.script.end();
    await firstRun;
    second.script.emit(init());
    second.script.emit(result());
    second.script.end();
    await secondRun;
    assert.equal(second.script.released(), true, 'the new turn ran to completion');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('a turn whose tool emits no task events still holds on the static rule', async () => {
  await withRun(async ({ script }) => {
    script.emit(init());
    script.emit(toolUse('toolu_monitor', 'Monitor', { command: 'tail -f x', description: 'watch', timeout_ms: 1000 }));
    script.emit(ack('toolu_monitor', 'Monitor started', {}));
    script.emit(result());
    await settle();

    assert.equal(script.released(), false, 'Monitor reports no task, so the launch rule decides');
  });
});

/** Two runs on one session, each with its own scripted CLI, sharing one client writer. */
async function withTwoRuns(
  sessionId: string,
  runTest: (context: {
    first: ReturnType<typeof createScriptedQuery>;
    second: ReturnType<typeof createScriptedQuery>;
    sent: NormalizedMessage[];
    start: (which: 'first' | 'second', prompt: string) => Promise<unknown>;
  }) => Promise<void>,
  firstBehaviour: Behaviour = {},
): Promise<void> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  const first = createScriptedQuery(firstBehaviour);
  const second = createScriptedQuery();
  const sent: NormalizedMessage[] = [];
  const writer = { send: (message: NormalizedMessage) => { sent.push(message); }, userId: null };
  const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
  const context: Omit<ProviderRuntimeContext, 'createQuery'> = {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
    normalizeMessage: (raw, id) => sessions.normalizeMessage(raw, id),
    isProviderInstalled: async () => true,
  };
  const start = (which: 'first' | 'second', prompt: string) => queryClaudeSDK(prompt, { sessionId, cwd }, writer as never,
    { ...context, createQuery: (which === 'first' ? first : second).createQuery });
  try {
    await runTest({ first, second, sent, start });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const say = (id: string, text: string) => ({
  type: 'assistant', session_id: NATIVE_ID, parent_tool_use_id: null,
  message: { id, role: 'assistant', model: 'claude-test', content: [{ type: 'text', text }] },
});
const mentions = (sent: NormalizedMessage[], text: string) => sent.some((message) => JSON.stringify(message).includes(text));

test('a process replaced while held for a Monitor is ended, and nothing it says reaches the chat', async () => {
  // Monitor reports no task, so there is nothing to stop by id: before the
  // fix the old CLI lived on, answered its own late turns into the chat and
  // wrote them to the same session file as its replacement.
  await withTwoRuns('app-hold-monitor', async ({ first, second, sent, start }) => {
    const firstRun = start('first', 'watch the build');
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_monitor', 'Monitor', { command: 'tail -f build.log', description: 'watch' }));
    first.script.emit(ack('toolu_monitor', 'Monitor started', {}));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));
    assert.equal(first.script.released(), false, 'held for the Monitor');

    const secondRun = start('second', 'next question');
    await settle();
    assert.equal(first.script.released(), true, 'the old process is let go');

    // A Monitor event wakes the old process into a turn of its own.
    first.script.emit(say('late', 'OLD PROCESS LATE REPLY'));
    await waitFor(() => first.script.closed());
    await firstRun;
    assert.equal(mentions(sent, 'OLD PROCESS LATE REPLY'), false, 'the replaced process is not heard');

    second.script.emit(init());
    second.script.emit(say('new', 'NEW PROCESS REPLY'));
    second.script.emit(result());
    await waitFor(() => mentions(sent, 'NEW PROCESS REPLY'));
    second.script.end();
    await secondRun;
    assert.equal(second.script.closed(), false, 'the new process is untouched');
  });
});

test('stopping a turn also stops its background agent and ends the process', async () => {
  await withTwoRuns('app-hold-abort', async ({ first, start }) => {
    const firstRun = start('first', 'start an agent');
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'long job', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    await settle();

    assert.equal(await abortClaudeSDKSession('app-hold-abort'), true);
    assert.deepEqual(first.script.stopped, ['a1'], 'interrupt() alone leaves the agent running');
    await waitFor(() => first.script.released());
    await waitFor(() => first.script.closed());
    await firstRun;
    assert.deepEqual(listClaudeSDKBackgroundWork(), []);
  });
});

test('a stop returns only once the stopped process is gone, and the next turn still reports complete', async () => {
  // A stopped process that went on running next to the turn that replaced it
  // kept working and writing the same session: the new turn then resumed one
  // branch of the transcript and took the old one's work for another
  // conversation's. So the stop now waits for the process to exit. (The stop
  // flag is keyed by process, so the stopped one cannot swallow the next
  // turn's `complete` either.)
  await withTwoRuns('app-hold-abort-next', async ({ first, second, sent, start }) => {
    const firstRun = start('first', 'start an agent');
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_agent', 'Agent', { prompt: 'long job', subagent_type: 'general-purpose', run_in_background: true }));
    first.script.emit(taskStarted('a1', 'toolu_agent', 'local_agent'));
    await settle();
    assert.equal(await abortClaudeSDKSession('app-hold-abort-next'), true);
    assert.equal(first.script.closed(), true, 'the stopped process is gone when the stop returns');
    await firstRun;

    const completesBefore = sent.filter((message) => message.kind === 'complete').length;
    const secondRun = start('second', 'next question');
    await settle();
    second.script.emit(init());
    second.script.emit(result());
    await waitFor(() => sent.filter((message) => message.kind === 'complete').length > completesBefore);

    second.script.end();
    await secondRun;
  });
});

test('a stop the CLI never answers still ends the process', async () => {
  // The CLI drops an interrupt written after its stdin has ended, and one busy
  // waking itself for background work may not answer for a long time. The
  // stop used to wait on the answer and, if it failed, leave the process
  // running.
  const previous = process.env.CLAUDE_INTERRUPT_TIMEOUT_MS;
  process.env.CLAUDE_INTERRUPT_TIMEOUT_MS = '80';
  try {
    await withTwoRuns('app-hold-abort-unanswered', async ({ first, start }) => {
      const firstRun = start('first', 'long job');
      await settle();
      first.script.emit(init());
      await settle();
      assert.equal(await abortClaudeSDKSession('app-hold-abort-unanswered'), true);
      assert.equal(first.script.closed(), true);
      await firstRun;
    }, { interruptNeverAnswers: true });
  } finally {
    process.env.CLAUDE_INTERRUPT_TIMEOUT_MS = previous;
  }
});

test('a stop reports failure when the process will not end', async () => {
  const previous = process.env.CLAUDE_PROCESS_EXIT_WAIT_MS;
  process.env.CLAUDE_PROCESS_EXIT_WAIT_MS = '80';
  try {
    await withTwoRuns('app-hold-abort-stuck', async ({ first, start }) => {
      const firstRun = start('first', 'long job');
      await settle();
      first.script.emit(init());
      await settle();
      assert.equal(await abortClaudeSDKSession('app-hold-abort-stuck'), false, 'the caller must not start another turn');
      first.script.end();
      await firstRun;
    }, { ignoresClose: true });
  } finally {
    process.env.CLAUDE_PROCESS_EXIT_WAIT_MS = previous;
  }
});

test('a new turn starts its process only after the held one it replaces has exited', async () => {
  await withTwoRuns('app-hold-replace-order', async ({ first, second, sent, start }) => {
    const firstRun = start('first', 'watch the build');
    await settle();
    first.script.emit(init());
    first.script.emit(toolUse('toolu_monitor', 'Monitor', { command: 'tail -f build.log', description: 'watch' }));
    first.script.emit(ack('toolu_monitor', 'Monitor started', {}));
    first.script.emit(result());
    await waitFor(() => sent.some((message) => message.kind === 'complete'));

    const secondRun = start('second', 'next question');
    await settle();
    // The held process is let go at once, but closed only after its grace.
    assert.equal(first.script.released(), true);
    assert.equal(first.script.closed(), false);
    assert.equal(second.script.created(), false, 'no second process while the first one lives');

    await waitFor(() => second.script.created());
    assert.equal(first.script.closed(), true, 'the first was gone before the second started');
    await firstRun;
    second.script.end();
    await secondRun;
  });
});

test('a real CLI process that outlives its close is killed, and the stop waits for it', async () => {
  // The runtime spawns the CLI itself (the SDK's spawnClaudeCodeProcess seam),
  // so it can see the process exit and kill one that will not. This child
  // ignores the end of its stdin, like a CLI waiting on background agents.
  const previous = process.env.CLAUDE_PROCESS_EXIT_WAIT_MS;
  process.env.CLAUDE_PROCESS_EXIT_WAIT_MS = '150';
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'claude-runtime-hold-'));
  let child: { exitCode: number | null; killed: boolean; kill: (signal: NodeJS.Signals) => boolean } | null = null;
  try {
    const sessions = new ClaudeSessionsProvider({ getLiveRunStartTime: () => null });
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => undefined,
      getProviderModels: async () => CLAUDE_PREDEFINED_MODELS as never,
      normalizeMessage: (raw, id) => sessions.normalizeMessage(raw, id),
      isProviderInstalled: async () => true,
      createQuery: ({ prompt, options }) => {
        void (async () => { for await (const _message of prompt) { /* stdin */ } })();
        const spawned = options.spawnClaudeCodeProcess({
          command: process.execPath,
          args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000);'],
          env: process.env,
        });
        child = spawned;
        const exited = new Promise<void>((resolve) => { spawned.once('exit', () => resolve()); });
        const iterator = (async function* () {
          yield init();
          await exited;
        })();
        return Object.assign(iterator, {
          interrupt: async () => {},
          // Like the SDK's close before its own kill fires: only stdin ends.
          close: () => { spawned.stdin.end(); },
        });
      },
    };
    const writer = { send: () => {}, userId: null };
    const run = queryClaudeSDK('long job', { sessionId: 'app-hold-real-child', cwd }, writer as never, context);
    await waitFor(() => child !== null);
    await settle();

    assert.equal(await abortClaudeSDKSession('app-hold-real-child'), true);
    const ended = child as unknown as { exitCode: number | null; killed: boolean };
    assert.ok(ended.killed || ended.exitCode !== null, 'the process is gone when the stop returns');
    await run;
  } finally {
    // Never leave the test's own child running, whatever happened above.
    (child as { kill: (signal: NodeJS.Signals) => boolean } | null)?.kill('SIGKILL');
    process.env.CLAUDE_PROCESS_EXIT_WAIT_MS = previous;
    await rm(cwd, { recursive: true, force: true });
  }
});

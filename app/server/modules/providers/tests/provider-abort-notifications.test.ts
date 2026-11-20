import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { WebSocket } from 'ws';

import {
  closeConnection,
  initializeDatabase,
  notificationPreferencesDb,
  userDb,
} from '@/modules/database/index.js';
import {
  registerDesktopNotificationClient,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/index.js';
import {
  abortClaudeSDKSession,
  isClaudeSDKSessionActive,
  queryClaudeSDK,
} from '@/modules/providers/list/claude/claude-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

/**
 * A run the user cancels must be reported as stopped/aborted, never as a
 * failure. Every notification channel (Web
 * Push, desktop, webhooks) receives the same event, so these watch the desktop
 * channel: a registered fake desktop client records each payload it is sent.
 */

type DesktopPayload = { body: string; data: { code: string; provider: string; sessionId: string | null } };

const findEnvKey = (name: string) =>
  Object.keys(process.env).find((key) => key.toLowerCase() === name.toLowerCase()) || name;

const runtimeContext: ProviderRuntimeContext = {
  resolveProviderSessionId: () => null,
  resolveResumeModel: async () => undefined,
  getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
  normalizeMessage: () => [],
  isProviderInstalled: async () => true,
};

async function waitFor(condition: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Isolated DB + one user whose desktop channel is on, with a fake desktop client attached. */
async function withDesktopListener(
  runTest: (context: { userId: number; payloads: DesktopPayload[]; binDir: string }) => Promise<void>,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const pathKey = findEnvKey('PATH');
  const previousPath = process.env[pathKey];
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'provider-abort-notifications-'));
  const payloads: DesktopPayload[] = [];
  const fakeSocket = {
    OPEN: 1,
    readyState: 1,
    send: (message: string) => {
      payloads.push(JSON.parse(message).payload as DesktopPayload);
    },
    close: () => {},
  } as unknown as WebSocket;

  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  process.env[pathKey] = `${temporaryDirectory}${path.delimiter}${previousPath || ''}`;
  await initializeDatabase();

  try {
    const userId = Number(userDb.createUser('abort-user', 'x').id);
    notificationPreferencesDb.updatePreferences(userId, {
      channels: { desktop: true },
      events: { actionRequired: true, stop: true, error: true },
    });
    registerDesktopNotificationClient({ userId, deviceId: 'test-device', ws: fakeSocket });
    await runTest({ userId, payloads, binDir: temporaryDirectory });
  } finally {
    unregisterDesktopNotificationClient(fakeSocket);
    closeConnection();
    process.env[pathKey] = previousPath;
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function createWriter(userId: number) {
  const writer = {
    userId,
    sessionIds: [] as string[],
    send: (_message: unknown) => {},
    setSessionId(sessionId: string) {
      writer.sessionIds.push(sessionId);
    },
  };
  return writer;
}

/**
 * A stand-in for the Claude SDK query: it reports the session, then waits.
 * `interrupt()` either ends the stream or makes it throw; the Claude CLI on
 * this box (measured in the real app) takes the throwing path:
 * "Claude Code returned an error result: [ede_diagnostic] result_type=user ...".
 */
function createInterruptibleQuery(
  mode: 'throws' | 'ends',
  { afterCompletedTurn = false }: { afterCompletedTurn?: boolean } = {},
): NonNullable<ProviderRuntimeContext['createQuery']> {
  return ({ prompt }) => {
    void (async () => {
      for await (const _message of prompt) { /* the CLI reads its stdin */ }
    })();
    let interrupted: (() => void) | null = null;
    const interruptedSignal = new Promise<void>((resolve) => { interrupted = resolve; });
    const iterator = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-native-abort' };
      if (afterCompletedTurn) {
        // The turn ends while a backgrounded command is still running, so the
        // runtime reports completion and holds the process open for it.
        yield {
          type: 'assistant',
          session_id: 'claude-native-abort',
          message: { content: [{ type: 'tool_use', id: 'bg-1', name: 'Bash', input: { command: 'sleep 60', run_in_background: true } }] },
        };
        yield { type: 'result', subtype: 'success', is_error: false, session_id: 'claude-native-abort' };
      }
      await interruptedSignal;
      if (mode === 'throws') {
        throw new Error('Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=null');
      }
    })();
    return Object.assign(iterator, {
      interrupt: async () => { interrupted?.(); },
      stopTask: async () => {},
    });
  };
}

for (const mode of ['throws', 'ends'] as const) {
  test(`claude: a cancelled run is reported as stopped/aborted (stream ${mode} on interrupt)`, async () => {
    await withDesktopListener(async ({ userId, payloads, binDir }) => {
      const sessionId = `claude-abort-session-${mode}`;
      const writer = createWriter(userId);
      const run = queryClaudeSDK('hello', { sessionId, cwd: binDir }, writer as never, {
        ...runtimeContext,
        createQuery: createInterruptibleQuery(mode),
      });
      await waitFor(() => isClaudeSDKSessionActive(sessionId), 'claude to start');

      assert.equal(await abortClaudeSDKSession(sessionId), true);
      await run;

      assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
      assert.match(payloads[0].body, /aborted$/);
      assert.equal(payloads[0].data.sessionId, sessionId);
    });
  });
}

test('claude: cancelling the post-turn hold of a completed turn sends no second notice', async () => {
  await withDesktopListener(async ({ userId, payloads, binDir }) => {
    const sessionId = 'claude-abort-session-held';
    const writer = createWriter(userId);
    const run = queryClaudeSDK('hello', { sessionId, cwd: binDir }, writer as never, {
      ...runtimeContext,
      createQuery: createInterruptibleQuery('throws', { afterCompletedTurn: true }),
    });
    await waitFor(() => payloads.length > 0, 'claude to report the completed turn');
    assert.equal(isClaudeSDKSessionActive(sessionId), true, 'the process is held for the background command');

    assert.equal(await abortClaudeSDKSession(sessionId), true);
    await run;

    assert.deepEqual(payloads.map((payload) => payload.data.code), ['run.stopped'], `notifications sent: ${JSON.stringify(payloads)}`);
    assert.match(payloads[0].body, /completed$/);
  });
});

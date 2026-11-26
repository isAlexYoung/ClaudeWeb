import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { sessionSynchronizerService, sessionsService } from '@/modules/providers/index.js';
import { handleChatConnection } from '@/modules/websocket/services/chat-websocket.service.js';
import { chatRunRegistry } from '@/modules/websocket/services/chat-run-registry.service.js';
import { connectedClients } from '@/modules/websocket/services/websocket-state.service.js';

const SESSION_ID = 'edit-session';

function createFakeSocket() {
  const socket = new EventEmitter() as EventEmitter & {
    readyState: number;
    frames: Array<Record<string, unknown>>;
    send: (data: string) => void;
  };
  socket.readyState = 1;
  socket.frames = [];
  socket.send = (data: string) => socket.frames.push(JSON.parse(data) as Record<string, unknown>);
  return socket;
}

/** Two turns and an edit of the second, which is the transcript the gateway reads. */
const TRANSCRIPT_ROWS = [
  {
    type: 'user', uuid: 'e-u1', parentUuid: null, sessionId: SESSION_ID,
    timestamp: '2026-08-23T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'first' }] },
  },
  {
    type: 'assistant', uuid: 'e-a1', parentUuid: 'e-u1', sessionId: SESSION_ID,
    timestamp: '2026-08-23T10:00:01.000Z',
    message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'reply' }] },
  },
  {
    type: 'user', uuid: 'e-u2', parentUuid: 'e-a1', sessionId: SESSION_ID,
    timestamp: '2026-08-23T10:00:02.000Z',
    message: { role: 'user', content: [{ type: 'text', text: 'second' }] },
  },
];

type RunCall = { provider: string; command: string; options: Record<string, unknown> };

/** What a stub run does with the gateway writer, e.g. announce the provider session it ran in. */
type OnRun = (writer: { setSessionId(id: string): void }, options: Record<string, unknown>) => void | Promise<void>;

/**
 * Set by a test that needs a run to still be in flight when the next frame
 * arrives; the stub runtime returns immediately otherwise. Released when the
 * test ends, so no stub run is left pending for the rest of the file.
 */
let holdRun: Promise<void> | null = null;
let releaseHeldRun: (() => void) | null = null;

function holdTheNextRun(): void {
  holdRun = new Promise<void>((resolve) => { releaseHeldRun = resolve; });
}

async function withGateway(
  provider: string,
  runTest: (context: {
    socket: ReturnType<typeof createFakeSocket>;
    runs: RunCall[];
    transcriptPath: string;
  }) => Promise<void>,
  rows: unknown[] = TRANSCRIPT_ROWS,
  onRun?: OnRun,
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-edit-send-'));
  const transcriptPath = path.join(tempDirectory, `${SESSION_ID}.jsonl`);
  await writeFile(transcriptPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  const runs: RunCall[] = [];
  const socket = createFakeSocket();

  try {
    const now = new Date().toISOString();
    sessionsDb.createSession(SESSION_ID, provider, tempDirectory, 'Edit session', now, now, transcriptPath);

    handleChatConnection(
      socket as never,
      { user: { id: 1 } } as never,
      {
        runtime: {
          hasRuntime: () => true,
          run: async (runProvider: string, command: string, options: Record<string, unknown>, writer: { setSessionId(id: string): void }) => {
            runs.push({ provider: runProvider, command, options });
            await onRun?.(writer, options);
            if (holdRun) {
              await holdRun;
            }
          },
        } as never,
      },
    );

    await runTest({ socket, runs, transcriptPath });
  } finally {
    releaseHeldRun?.();
    releaseHeldRun = null;
    holdRun = null;
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** The handler is async and the socket listener does not await it. */
const settle = () => new Promise((resolve) => { setTimeout(resolve, 30); });

test('an edit resumes through the turn before the one being replaced', async () => {
  await withGateway('claude', async ({ socket, runs }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'e-u2',
      content: 'a better second prompt',
    }));
    await settle();

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'a better second prompt');
    // Inclusive of the row it names, so this is the last turn KEPT.
    assert.equal(runs[0].options.resumeAnchorId, 'e-a1');
    assert.equal(runs[0].options.resumeFromScratch, false);
  });
});

test('editing the first prompt starts the conversation over', async () => {
  await withGateway('claude', async ({ socket, runs }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'e-u1',
      content: 'a better first prompt',
    }));
    await settle();

    assert.equal(runs.length, 1);
    assert.equal(runs[0].options.resumeAnchorId, undefined);
    assert.equal(runs[0].options.resumeFromScratch, true);
  });
});

test('every subscribed client is told to drop the superseded turns', async () => {
  await withGateway('claude', async ({ socket }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'e-u2',
      content: 'replacement',
    }));
    await settle();

    const truncation = socket.frames.find((frame) => frame.kind === 'history_truncated');
    assert.ok(truncation, 'a history_truncated frame is emitted');
    assert.equal(truncation?.anchorId, 'e-u2');
    assert.equal(truncation?.sessionId, SESSION_ID);
    // Sequenced like every other run event, so a reconnecting tab replays it.
    assert.equal(typeof truncation?.seq, 'number');
  });
});

test('an edit without an anchor is refused', async () => {
  await withGateway('claude', async ({ socket, runs }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      content: 'no anchor',
    }));
    await settle();

    assert.equal(runs.length, 0);
    assert.equal(socket.frames.at(-1)?.code, 'ANCHOR_REQUIRED');
  });
});

test('an anchor the transcript does not hold is refused', async () => {
  await withGateway('claude', async ({ socket, runs }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'not-in-transcript',
      content: 'replacement',
    }));
    await settle();

    assert.equal(runs.length, 0);
    assert.equal(socket.frames.at(-1)?.code, 'ANCHOR_NOT_FOUND');
  });
});

test('editing the first prompt moves the conversation onto the new provider session, leaving the old one behind', async () => {
  // As Claude does when a conversation starts over: the replacement runs in a
  // provider session of its own, announced on the writer.
  const announceNewSession: OnRun = (writer, options) => {
    if (options.resumeFromScratch) writer.setSessionId('replacement-native');
  };
  await withGateway('claude', async ({ socket, transcriptPath }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'e-u1',
      content: 'a better first prompt',
    }));
    await settle();

    // This session was discovered from disk (its app id is the old provider
    // id), the case where re-indexing the old file would point it back.
    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.equal(row?.provider_session_id, 'replacement-native');
    assert.equal(row?.jsonl_path, null, 'the new transcript is recorded by the indexer once it is on disk');
    assert.equal(sessionsDb.isProviderSessionSuperseded(SESSION_ID, 'claude'), true);
    assert.deepEqual(sessionsDb.getSupersededTranscriptPaths(SESSION_ID), [transcriptPath]);

    // The pre-edit transcript is not offered back as a conversation, and the
    // session keeps pointing at the replacement.
    assert.equal((await sessionSynchronizerService.synchronizeProviderFile('claude', transcriptPath)).indexed, false);
    assert.equal(sessionsDb.getSessionById(SESSION_ID)?.provider_session_id, 'replacement-native');
  }, TRANSCRIPT_ROWS.map((row) => ({ ...row, cwd: '/tmp/edit-project' })), announceNewSession);
});

test('a first-prompt edit stopped before the provider started leaves the conversation where it was', async () => {
  await withGateway('claude', async ({ socket, transcriptPath }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'e-u1',
      content: 'a better first prompt',
    }));
    await settle();

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.equal(row?.provider_session_id, SESSION_ID);
    assert.equal(row?.jsonl_path, transcriptPath);
    assert.equal(sessionsDb.isProviderSessionSuperseded(SESSION_ID, 'claude'), false);
  });
});

test('an edit further down stays in the same provider session', async () => {
  await withGateway('claude', async ({ socket, transcriptPath }) => {
    socket.emit('message', JSON.stringify({
      type: 'chat.edit-send',
      sessionId: SESSION_ID,
      anchorId: 'e-u2',
      content: 'a better second prompt',
    }));
    await settle();

    const row = sessionsDb.getSessionById(SESSION_ID);
    assert.equal(row?.provider_session_id, SESSION_ID);
    assert.equal(row?.jsonl_path, transcriptPath);
    assert.equal(sessionsDb.isProviderSessionSuperseded(SESSION_ID, 'claude'), false);
  }, TRANSCRIPT_ROWS, (writer) => writer.setSessionId(SESSION_ID));
});

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, scheduledMessagesDb, sessionDraftsDb, sessionsDb, userDb } from '@/modules/database/index.js';
import { dispatchDueScheduledMessages, dispatchQueuedMessages, sendQueuedMessageNow, changeQueuedMessage } from '@/modules/scheduled-messages/services/scheduled-message-dispatcher.service.js';
import { scheduledMessagesService } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';

const SESSION_ID = 'scheduled-session';

async function withIsolatedDatabase(runTest: (userId: number) => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'scheduled-messages-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();

  try {
    const user = userDb.createUser('scheduler', 'hash');
    sessionsDb.createAppSession(SESSION_ID, 'claude', tempDirectory, 'Scheduled session');
    await runTest(Number(user.id));
  } finally {
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

function createRuntime(
  runs: RunCall[],
  behaviour: 'ok' | 'throw' = 'ok',
  aborts: string[] = [],
  hasBackgroundWork: (sessionId: string) => boolean = () => false,
) {
  return {
    hasRuntime: () => true,
    hasBackgroundWork,
    run: async (provider: string, command: string, options: Record<string, unknown>) => {
      if (behaviour === 'throw') {
        throw new Error('provider exploded');
      }
      runs.push({ provider, command, options });
    },
    abort: async (_provider: string, sessionId: string) => {
      aborts.push(sessionId);
      return true;
    },
  } as never;
}

/** A chat socket that records what it is sent, standing in for an open browser tab. */
class FakeConnection {
  readyState = 1; // WS_OPEN_STATE
  frames: Array<Record<string, unknown>> = [];

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Record<string, unknown>);
  }

  /** The scheduled-message announcements among everything this socket received. */
  announcements(): Array<Record<string, unknown>> {
    return this.frames.filter((frame) => frame.kind === 'scheduled_messages_changed');
  }
}

function openTab(): FakeConnection {
  const connection = new FakeConnection();
  connectedClients.add(connection as never);
  return connection;
}

test('a message due in the past is sent on the next pass, not skipped', async () => {
  await withIsolatedDatabase(async (userId) => {
    // The server was down when this came due.
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'run the nightly checks',
      scheduledFor: new Date(Date.now() - 60_000).toISOString(),
    });

    const runs: RunCall[] = [];
    const sent = await dispatchDueScheduledMessages(createRuntime(runs));

    assert.equal(sent, 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'run the nightly checks');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'sent');
  });
});

test('a queued message is sent by the server without a browser connection', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: {
        content: 'continue on the VPS',
        options: { model: 'claude-opus-5' },
        attachments: [{ path: '/tmp/upload.png' }],
      },
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'continue on the VPS');
    assert.equal(runs[0].options.model, 'claude-opus-5');
    assert.deepEqual(runs[0].options.attachments, []);
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a queued message stays pending while its session is busy', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: { content: 'send after this run' },
    });
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
    assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, {
      content: 'send after this run',
    });
  });
});

test('a queued message waits for background work its session\'s last turn left running', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, {
      text: '',
      queuedMessage: { content: 'send after the background job' },
    });
    // Turn A ended, so its run is completed, but it backgrounded a command
    // that is still running under A's CLI process.
    const runA = chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });
    runA!.writer.sendComplete({ exitCode: 0 });
    assert.equal(chatRunRegistry.isProcessing(SESSION_ID), false);

    let backgroundWork = true;
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs, 'ok', [], (sessionId) => sessionId === SESSION_ID && backgroundWork);

    // Starting B now would replace that process and stop the command.
    assert.equal(await dispatchQueuedMessages(runtime), 0);
    assert.equal(runs.length, 0);
    assert.deepEqual(sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage, {
      content: 'send after the background job',
    });

    // Once the work has reported back, B goes on the next pass.
    backgroundWork = false;
    assert.equal(await dispatchQueuedMessages(runtime), 1);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'send after the background job');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('follow-ups queued during one turn are all sent, once, in order, as the next turn', async () => {
  await withIsolatedDatabase(async (userId) => {
    for (const content of ['follow-up A', 'follow-up B', 'follow-up C']) {
      sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content, options: { model: 'opus' }, attachments: [] });
    }

    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0, 'nothing is left to send');

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'follow-up A\n\nfollow-up B\n\nfollow-up C');
    assert.equal(runs[0].options.model, 'opus');
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 0);
  });
});

test('a draft-text save after the queued message was sent does not send it again', async () => {
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.appendQueuedMessage(userId, SESSION_ID, { content: 'send me once', attachments: [] });
    const runs: RunCall[] = [];
    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 1);

    // The composer keeps saving its text while the user types the next
    // follow-up; its copy of the queue still holds the message just sent.
    sessionDraftsDb.saveDraftText(userId, SESSION_ID, 'typing the next one');

    assert.equal(await dispatchQueuedMessages(createRuntime(runs)), 0);
    assert.deepEqual(runs.map((run) => run.command), ['send me once']);
  });
});

test('a due message interrupts a run in progress instead of failing', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'the schedule wins',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    chatRunRegistry.startRun({
      appSessionId: SESSION_ID,
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId,
    });

    const runs: RunCall[] = [];
    const aborts: string[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs, 'ok', aborts)), 1);

    assert.deepEqual(aborts, [SESSION_ID]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'the schedule wins');
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'sent');
  });
});

test('a message that is not due yet is left alone', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'later',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
  });
});

test('a due message is claimed once, so overlapping passes cannot double-send it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'only once',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    await Promise.all([
      dispatchDueScheduledMessages(runtime),
      dispatchDueScheduledMessages(runtime),
    ]);

    assert.equal(runs.length, 1);
  });
});

test('the composer settings it was scheduled with travel with it', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'with options',
      options: { model: 'claude-opus-5', permissionMode: 'plan' },
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    const runs: RunCall[] = [];
    await dispatchDueScheduledMessages(createRuntime(runs));

    assert.equal(runs[0].options.model, 'claude-opus-5');
    assert.equal(runs[0].options.permissionMode, 'plan');
  });
});

test('a provider failure is recorded on the message instead of vanishing', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });

    await dispatchDueScheduledMessages(createRuntime([], 'throw'));

    const row = scheduledMessagesDb.listForSession(userId, SESSION_ID)[0];
    assert.equal(row.status, 'failed');
    assert.match(row.failure_reason ?? '', /provider exploded/);
  });
});

test('a cancelled message never fires', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'never mind',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    scheduledMessagesService.cancel(userId, scheduled.id);

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 0);
    assert.equal(runs.length, 0);
  });
});

test('a failed message can be dismissed, and stays dismissed', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([], 'throw'));
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'failed');

    scheduledMessagesService.cancel(userId, scheduled.id);

    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'cancelled');
  });
});

test('cancelling something that already fired is refused', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'gone',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    await dispatchDueScheduledMessages(createRuntime([]));

    assert.throws(
      () => scheduledMessagesService.cancel(userId, scheduled.id),
      (error: Error & { code?: string }) => error.code === 'SCHEDULED_MESSAGE_NOT_PENDING',
    );
  });
});

test('one user cannot cancel another user\'s scheduled message', async () => {
  await withIsolatedDatabase(async (userId) => {
    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'mine',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });

    assert.throws(
      () => scheduledMessagesService.cancel(userId + 1, scheduled.id),
      (error: Error & { code?: string }) => error.code === 'SCHEDULED_MESSAGE_NOT_PENDING',
    );
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'pending');
  });
});

test('scheduling validates its input', async () => {
  await withIsolatedDatabase(async (userId) => {
    const base = { userId, sessionId: SESSION_ID, scheduledFor: new Date(Date.now() + 1000).toISOString() };

    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, content: '   ' }),
      (error: Error & { code?: string }) => error.code === 'CONTENT_REQUIRED',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, content: 'hi', scheduledFor: 'not a date' }),
      (error: Error & { code?: string }) => error.code === 'INVALID_SCHEDULE_TIME',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({
        ...base,
        content: 'hi',
        scheduledFor: new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString(),
      }),
      (error: Error & { code?: string }) => error.code === 'SCHEDULE_TOO_FAR_AHEAD',
    );
    assert.throws(
      () => scheduledMessagesService.schedule({ ...base, sessionId: 'nope', content: 'hi' }),
      (error: Error & { code?: string }) => error.code === 'SESSION_NOT_FOUND',
    );
  });
});

// The composer banner is read over REST, so these announcements are the only
// way an open tab learns that its list changed without it doing anything
// (#1546): the banner of a message the timer had already sent stayed up until
// a reload.

test('a due message is announced to open tabs as it is claimed, before its turn runs', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'run the nightly checks',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const tab = openTab();

    let announcedBeforeTheTurn: Array<Record<string, unknown>> = [];
    const runtime = {
      hasRuntime: () => true,
      hasBackgroundWork: () => false,
      run: async () => {
        announcedBeforeTheTurn = tab.announcements();
      },
      abort: async () => true,
    } as never;
    assert.equal(await dispatchDueScheduledMessages(runtime), 1);

    // The banner comes down when the turn starts, not after it finishes,
    // which for a long turn can be many minutes later.
    assert.equal(announcedBeforeTheTurn.length, 1);
    assert.equal(announcedBeforeTheTurn[0].sessionId, SESSION_ID);
    assert.equal(tab.announcements().length, 1);
  });
});

test('a pass announces each session it claimed from once, however many of its messages were due', async () => {
  await withIsolatedDatabase(async (userId) => {
    const otherSessionId = 'other-scheduled-session';
    sessionsDb.createAppSession(otherSessionId, 'claude', tmpdir(), 'Other scheduled session');
    for (const [sessionId, content] of [
      [SESSION_ID, 'first for this session'],
      [SESSION_ID, 'second for this session'],
      [otherSessionId, 'only one for the other session'],
    ]) {
      scheduledMessagesService.schedule({
        userId,
        sessionId,
        content,
        scheduledFor: new Date(Date.now() - 1_000).toISOString(),
      });
    }
    const tab = openTab();

    assert.equal(await dispatchDueScheduledMessages(createRuntime([])), 3);

    // One read per session is enough: a single GET returns all of its rows.
    assert.deepEqual(tab.announcements().map((frame) => frame.sessionId).sort(), [otherSessionId, SESSION_ID]);
  });
});

test('a message that fails to send is announced again once the reason is recorded', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'will fail',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const tab = openTab();

    await dispatchDueScheduledMessages(createRuntime([], 'throw'));

    // Claimed (the banner comes down), then failed (it comes back as the
    // failure notice).
    assert.deepEqual(tab.announcements().map((frame) => frame.sessionId), [SESSION_ID, SESSION_ID]);
    assert.equal(scheduledMessagesDb.listForSession(userId, SESSION_ID)[0].status, 'failed');
  });
});

test('scheduling and cancelling are announced, so other tabs and devices follow', async () => {
  await withIsolatedDatabase(async (userId) => {
    const tab = openTab();

    const scheduled = scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'from another tab',
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(tab.announcements().length, 1);

    scheduledMessagesService.cancel(userId, scheduled.id);
    assert.equal(tab.announcements().length, 2);

    // A refused cancel changed nothing, so there is nothing to announce.
    assert.throws(() => scheduledMessagesService.cancel(userId, scheduled.id));
    assert.equal(tab.announcements().length, 2);

    // The frame names the session and nothing else: each tab reads the list
    // again through its own authenticated request.
    for (const frame of tab.announcements()) {
      assert.deepEqual(Object.keys(frame).sort(), ['kind', 'sessionId', 'timestamp']);
      assert.equal(frame.sessionId, SESSION_ID);
    }
  });
});

test('a socket that cannot be written to does not stop a claimed message from being sent', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'still goes',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    const closedTab = openTab();
    closedTab.readyState = 3; // CLOSED
    connectedClients.add({
      readyState: 1,
      send: () => {
        throw new Error('socket went away mid-send');
      },
    } as never);

    const runs: RunCall[] = [];
    assert.equal(await dispatchDueScheduledMessages(createRuntime(runs)), 1);

    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'still goes');
    assert.equal(closedTab.frames.length, 0);
  });
});


test('immediate queued send interrupts the active run, keeps uploads and claims only once', async () => {
  await withIsolatedDatabase(async userId => {
    const attachment = { name: 'design.png', path: 'design.png', mimeType: 'image/png', size: 42 };
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: 'a separate draft', queuedMessage: {
      content: 'send this now', options: { model: 'opus' }, attachments: [attachment],
    } });
    chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
    const runs: RunCall[] = [], aborts: string[] = [];
    const runtime = createRuntime(runs, 'ok', aborts);
    assert.deepEqual(sendQueuedMessageNow(userId, SESSION_ID, runtime), { accepted: true });
    assert.throws(() => sendQueuedMessageNow(userId, SESSION_ID, runtime), /already been sent/);
    // Dispatch now stats attachment files asynchronously. One setImmediate is
    // not an I/O completion barrier; closing the fixture DB while it is still
    // dispatching also hides the original assertion behind a SQLite error.
    const deadline = Date.now() + 5_000;
    while (runs.length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(aborts, [SESSION_ID]);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].command, 'send this now');
    assert.deepEqual(runs[0].options.attachments, [attachment]);
    assert.equal(await dispatchQueuedMessages(runtime), 0);
    assert.equal(sessionDraftsDb.getDrafts(userId)[0].text, 'a separate draft');
  });
});

test('queue actions cannot read or dispatch another user queue', async () => {
  await withIsolatedDatabase(async userId => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: '', queuedMessage: { content: 'private queue' } });
    const runs: RunCall[] = [];
    assert.throws(() => sendQueuedMessageNow(userId + 1, SESSION_ID, createRuntime(runs)), /already been sent/);
    assert.throws(() => changeQueuedMessage(userId + 1, SESSION_ID, 'private queue', 'changed'), /changed/);
    assert.equal(runs.length, 0);
    assert.equal(sessionDraftsDb.getDrafts(userId).length, 1);
  });
});

test('a queue is restored when an immediate send cannot start its provider', async () => {
  await withIsolatedDatabase(async userId => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: 'draft', queuedMessage: { content: 'retry later' } });
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    Object.assign(runtime, { hasRuntime: () => false });
    sendQueuedMessageNow(userId, SESSION_ID, runtime);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runs.length, 0);
    assert.equal((sessionDraftsDb.getDrafts(userId)[0].queuedMessage as { content: string }).content, 'retry later');
    assert.equal(sessionDraftsDb.getDrafts(userId)[0].text, 'draft');
  });
});

test('editing and cancelling a queued snapshot preserve files and drafts and refuse stale edits', async () => {
  await withIsolatedDatabase(async userId => {
    const attachments = [{ name: 'notes.pdf', path: '/uploads/notes.pdf' }];
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: 'keep my typing', queuedMessage: {
      content: 'before', options: { model: 'opus' }, attachments,
    } });
    const result = changeQueuedMessage(userId, SESSION_ID, 'before', 'after');
    assert.deepEqual(result.queuedMessage, { content: 'after', options: { model: 'opus' }, attachments });
    assert.throws(() => changeQueuedMessage(userId, SESSION_ID, 'before', 'stale'), /changed/);
    assert.equal(sessionDraftsDb.getDrafts(userId)[0].text, 'keep my typing');
    assert.deepEqual(changeQueuedMessage(userId, SESSION_ID, 'after', null), { queuedMessage: null });
    assert.throws(() => changeQueuedMessage(userId, SESSION_ID, 'after', 'resurrect'), /changed/);
    assert.equal(sessionDraftsDb.getDrafts(userId)[0].text, 'keep my typing');
  });
});

test('an immediate send that cannot stop the reply in progress keeps the queue and says so', async () => {
  // Starting the new turn anyway would put a second process on the session
  // next to one still working, both writing its transcript.
  await withIsolatedDatabase(async (userId) => {
    sessionDraftsDb.saveDraft(userId, SESSION_ID, { text: '', queuedMessage: { content: 'change of plan' } });
    const tab = openTab();
    chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: tab as never, userId });
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    Object.assign(runtime, { abort: async () => false });

    assert.deepEqual(sendQueuedMessageNow(userId, SESSION_ID, runtime), { accepted: true });
    const deadline = Date.now() + 5_000;
    while (!sessionDraftsDb.getDrafts(userId)[0]?.queuedMessage && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(runs.length, 0, 'no second turn next to the one that would not stop');
    assert.equal((sessionDraftsDb.getDrafts(userId)[0].queuedMessage as { content: string }).content, 'change of plan');
    assert.equal(chatRunRegistry.getRun(SESSION_ID)?.status, 'running', 'the reply in progress is not marked finished');
    assert.ok(
      tab.frames.some((frame) => frame.kind === 'error' && String(frame.content).includes('could not be stopped')),
      `the conversation says why: ${JSON.stringify(tab.frames)}`,
    );
  });
});

test('a due message that cannot stop the reply in progress is recorded as not sent', async () => {
  await withIsolatedDatabase(async (userId) => {
    scheduledMessagesService.schedule({
      userId,
      sessionId: SESSION_ID,
      content: 'the schedule',
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
    });
    chatRunRegistry.startRun({ appSessionId: SESSION_ID, provider: 'claude', providerSessionId: null, connection: null, userId });
    const runs: RunCall[] = [];
    const runtime = createRuntime(runs);
    Object.assign(runtime, { abort: async () => false });

    assert.equal(await dispatchDueScheduledMessages(runtime), 1);
    assert.equal(runs.length, 0);
    const [message] = scheduledMessagesDb.listForSession(userId, SESSION_ID);
    assert.equal(message.status, 'failed');
    assert.match(String(message.failure_reason), /could not be stopped/);
  });
});

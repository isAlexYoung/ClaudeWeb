import { scheduledMessagesDb, sessionDraftsDb } from '@/modules/database/index.js';
import type { QueuedSessionMessageRecord, ScheduledMessageRow } from '@/modules/database/index.js';
import { announceScheduledMessagesChanged } from '@/modules/scheduled-messages/services/scheduled-messages.service.js';
import { chatRunRegistry, runDetachedChatTurn, RUN_NOT_STOPPED_ERROR } from '@/modules/websocket/index.js';
import type { ProviderRuntimeGateway } from '@/modules/websocket/index.js';
import { AppError, createNormalizedMessage, readQueuedChatMessage } from '@/shared/utils.js';

/**
 * How often due messages are looked for.
 *
 * A minute is the granularity the composer offers, and a claim is indexed on
 * `(status, scheduled_for)`, so the poll is one cheap query. Anything finer
 * would buy precision nobody asked for.
 */
const POLL_INTERVAL_MS = 30_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let dispatchInFlight = false;
let dispatcherRuntime: ProviderRuntimeGateway | null = null;

function readOptions(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function sendClaimedQueuedMessage(
  candidate: QueuedSessionMessageRecord,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  const message = readQueuedChatMessage(candidate.queuedMessage);
  if (!message) {
    sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
    return;
  }

  const result = await runDetachedChatTurn(
    {
      sessionId: candidate.sessionId,
      userId: candidate.userId,
      content: message.content,
      options: { ...message.options, attachments: message.attachments },
    },
    { runtime },
  );

  // The registry check and run reservation are separate operations. If a run
  // wins that tiny race, put the turn back so the next poll tries again.
  if (!result.started && result.error === 'A run was already in progress for this session.') {
    sessionDraftsDb.restoreQueuedMessage(candidate);
    return;
  }
  sessionDraftsDb.deleteEmptyDraft(candidate.userId, candidate.sessionId);
}

/**
 * Whether a queued turn has to keep waiting for the session.
 *
 * A turn that ends with background work still going (a backgrounded command,
 * agent or workflow) is marked completed, but its CLI process stays open so
 * that work can report back. A new turn replaces that process and stops the
 * work, which is why the composer asks before an interactive send. A queued
 * turn was promised to go "when this finishes", so it waits for that work too.
 */
function isSessionBusy(sessionId: string, runtime: ProviderRuntimeGateway): boolean {
  return chatRunRegistry.isProcessing(sessionId) || runtime.hasBackgroundWork(sessionId);
}

/** Sends every persisted queued turn whose session is currently idle. */
export async function dispatchQueuedMessages(runtime: ProviderRuntimeGateway): Promise<number> {
  const candidates = sessionDraftsDb.listQueuedMessages();
  let claimed = 0;

  await Promise.all(candidates.map(async (candidate) => {
    if (isSessionBusy(candidate.sessionId, runtime)) {
      return;
    }
    if (!sessionDraftsDb.claimQueuedMessage(candidate)) {
      return;
    }
    claimed += 1;
    await sendClaimedQueuedMessage(candidate, runtime);
  }));

  return claimed;
}

/** Records why a claimed message did not go, and shows it on its session's banner. */
function recordFailure(row: ScheduledMessageRow, reason: string): void {
  scheduledMessagesDb.markFailed(row.id, reason);
  announceScheduledMessagesChanged(row.session_id);
}

async function sendClaimedMessage(
  row: ScheduledMessageRow,
  runtime: ProviderRuntimeGateway,
): Promise<void> {
  try {
    const result = await runDetachedChatTurn(
      {
        sessionId: row.session_id,
        userId: row.user_id,
        content: row.content,
        options: readOptions(row.options),
        // The user picked this time on purpose; a run that happens to be going
        // is aborted so the scheduled message lands when it was due, instead
        // of being recorded as "not sent — session was busy".
        interruptActiveRun: true,
      },
      { runtime },
    );

    // Recorded rather than retried, and recorded whether the run never started
    // (deleted session, unavailable provider) or started and then failed.
    // Silently dropping a message the user scheduled is worse than telling
    // them it did not go.
    if (!result.started || result.error) {
      recordFailure(row, result.error ?? 'The session was unavailable when this was due.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordFailure(row, message);
  }
}

/**
 * Sends every message whose time has come.
 *
 * Exported so a test can drive one pass without waiting on the timer.
 */
export async function dispatchDueScheduledMessages(
  runtime: ProviderRuntimeGateway,
  now: Date = new Date(),
): Promise<number> {
  // Claimed before any of them runs, so a long turn cannot let the next poll
  // pick the same message up again.
  const due = scheduledMessagesDb.claimDue(now);
  if (due.length === 0) {
    return 0;
  }

  // The claim already recorded them as sent, so their banners come down now,
  // as the turns start, rather than once the last turn has finished.
  for (const sessionId of new Set(due.map((row) => row.session_id))) {
    announceScheduledMessagesChanged(sessionId);
  }

  // Sequentially: a session can only have one run at a time, and two due
  // messages for the same session must not race each other into it.
  for (const row of due) {
    await sendClaimedMessage(row, runtime);
  }

  return due.length;
}

/**
 * Starts the poll that sends scheduled messages.
 *
 * The schedule lives in the database, so a message stays scheduled across a
 * restart and one that came due while the server was down is sent on the first
 * poll after it comes back, rather than being skipped.
 */
export function initializeScheduledMessageDispatcher(runtime: ProviderRuntimeGateway): void {
  dispatcherRuntime = runtime;
  if (pollTimer) {
    return;
  }

  const poll = () => {
    // A pass that overruns the interval must not be started again underneath
    // itself; the claim is transactional but the runs are not.
    if (dispatchInFlight) {
      return;
    }
    dispatchInFlight = true;
    void dispatchDueScheduledMessages(runtime)
      .then(() => dispatchQueuedMessages(runtime))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ScheduledMessages] Dispatch pass failed', { error: message });
      })
      .finally(() => {
        dispatchInFlight = false;
      });
  };

  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  // Never keep the process alive just to poll for scheduled messages.
  pollTimer.unref?.();

  // Catch up on anything that came due while the server was not running.
  poll();
}

export function closeScheduledMessageDispatcher(): void {
  dispatcherRuntime = null;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Says, in the conversation, why "send now" did not send: the reply in
 * progress could not be stopped, so the message went back to the queue and
 * goes when that reply ends. Sent through the running reply's own stream, the
 * one every open tab of the session is following.
 */
function tellQueueKept(sessionId: string): void {
  const run = chatRunRegistry.getRun(sessionId);
  if (!run || run.status !== 'running') return;
  run.writer.send(createNormalizedMessage({
    kind: 'error',
    content: 'The reply in progress could not be stopped, so your message stays in the queue. It will be sent when this reply finishes.',
    sessionId,
    provider: run.provider,
  }));
}

/** Used by the queued-send HTTP route to claim once, interrupt the current run and dispatch durably. */
export function sendQueuedMessageNow(userId: number, sessionId: string, runtime = dispatcherRuntime) {
  if (!runtime) throw new AppError('Chat runtime is unavailable.', { code: 'RUNTIME_UNAVAILABLE', statusCode: 503 });
  const candidate = sessionDraftsDb.listQueuedMessages().find(row => row.userId === userId && row.sessionId === sessionId);
  const message = candidate && readQueuedChatMessage(candidate.queuedMessage);
  if (!candidate || !message || !sessionDraftsDb.claimQueuedMessage(candidate)) {
    throw new AppError('The queued message has already been sent or cancelled.', { code: 'QUEUE_ALREADY_CLAIMED', statusCode: 409 });
  }
  // Claiming happens before abort awaits, so the idle dispatcher cannot send the same message twice.
  void runDetachedChatTurn({ sessionId, userId, content: message.content,
    options: { ...message.options, attachments: message.attachments }, interruptActiveRun: true }, { runtime })
    .then(result => {
      if (!result.started) {
        sessionDraftsDb.restoreQueuedMessage(candidate);
        if (result.error === RUN_NOT_STOPPED_ERROR) tellQueueKept(sessionId);
      } else sessionDraftsDb.deleteEmptyDraft(userId, sessionId);
    }).catch((error: unknown) => {
      sessionDraftsDb.restoreQueuedMessage(candidate);
      console.error('[QueuedMessage] Immediate send failed', { sessionId, error });
    });
  return { accepted: true };
}

/** Edits or cancels the displayed queue snapshot; a sent/changed queue cannot be brought back by saving. */
export function changeQueuedMessage(userId: number, sessionId: string, expectedContent: string, content: string | null) {
  const candidate = sessionDraftsDb.listQueuedMessages().find(row => row.userId === userId && row.sessionId === sessionId);
  const message = candidate && readQueuedChatMessage(candidate.queuedMessage);
  if (content !== null && (content.length > 100_000 || (!content.trim() && !message?.attachments.length))) {
    throw new AppError('Queued text must be nonempty and at most 100000 characters.', { code: 'INVALID_QUEUED_TEXT', statusCode: 400 });
  }
  if (!candidate || !message || message.content !== expectedContent || !(content === null
    ? sessionDraftsDb.claimQueuedMessage(candidate) : sessionDraftsDb.editQueuedMessage(candidate, content))) {
    throw new AppError('The queued message changed or has already been sent. Refresh and try again.', { code: 'QUEUE_CHANGED', statusCode: 409 });
  }
  if (content === null) sessionDraftsDb.deleteEmptyDraft(userId, sessionId);
  return { queuedMessage: content === null ? null : { ...message, content } };
}

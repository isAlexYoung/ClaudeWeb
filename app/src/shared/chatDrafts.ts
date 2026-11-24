import { api, ApiRequestError, readApiErrorMessage } from '@/shared/api';
import type { QueuedSendOptions } from '@/shared/types';

/**
 * Unsent composer text and queued messages, stored in `auth.db` rather than in
 * the browser.
 *
 * This is what lets a message half-typed on a laptop be finished on a phone —
 * the case the composer previously could not serve at all, because a draft only
 * existed on the machine it was typed on. As with the preference store, a
 * localStorage mirror is kept purely so a reload shows the draft on the first
 * paint instead of a blank composer that fills in a moment later.
 *
 * A scope is a session id, or `project:<projectId>` for a chat that has not
 * been sent yet and so has no session. Drafts used to be keyed by project
 * alone, which meant every session in a project shared one draft.
 *
 * The text and the queued message travel separately. Text is saved on a
 * debounce and never carries the queue. The queued message is owned by the
 * server: queueing appends to it there, editing or deleting it clears it
 * there, and the server's dispatcher sends it. The copy kept here is only
 * what this page last heard, which can already be out of date (sent, or added
 * to from another tab), so it is never written back.
 */

/** A queued message as it is stored: text plus the send options it was composed under. */
export type StoredQueuedMessage = {
  content: string;
  options?: QueuedSendOptions;
  /** Legacy image-only descriptors retained for queued draft compatibility. */
  images?: unknown[];
  /**
   * JSON-safe descriptors returned by POST /api/assets/files. Unlike browser
   * File objects, they can follow a queued message across session switches.
   */
  attachments?: unknown[];
};

type DraftRecord = {
  text: string;
  queuedMessage: StoredQueuedMessage | null;
};

/** Fired after any draft changes, from a local write or from a hydrate. */
export const CHAT_DRAFTS_CHANGED_EVENT = 'chat-drafts:changed';

const MIRROR_STORAGE_KEY = 'chat-drafts';

/**
 * Longer than the preference debounce: this fires on every keystroke, and a
 * draft is only ever read back on a reload or a device switch, so trading a
 * little latency for far fewer requests is the right side of the trade.
 */
const SERVER_WRITE_DEBOUNCE_MS = 1_000;

const EMPTY_DRAFT: DraftRecord = { text: '', queuedMessage: null };

const listeners = new Set<() => void>();

let drafts = new Map<string, DraftRecord>();
// Dirty text stays protected through the PUT acknowledgement, not just its debounce.
const pendingScopes = new Set<string>();
let serverWriteTimer: ReturnType<typeof setTimeout> | null = null;
// Revisions protect typing that happens after a GET starts, even if its PUT finishes first.
const textRevisions = new Map<string, number>();
// One text PUT per scope prevents an older request from reaching the server last.
const textRequests = new Map<string, Promise<void>>();
// Ignore responses from before sign-out and older overlapping draft reads.
let storeGeneration = 0;
let hydrateSequence = 0;
let lastAppliedHydrate = 0;
// Counts this page's changes to each scope's queued message, so a hydrate that
// was already in flight when one happened does not put back the older copy.
const queueRevisions = new Map<string, number>();
// The last queue request (append or clear) made for each scope, settled once
// the server has answered it. The next one waits for it, so the server applies
// them in the order they were made: an Edit's clear that reached the server
// after the message re-queued from it would otherwise delete that message.
const queueRequests = new Map<string, Promise<void>>();
// The last clear made for each scope, resolving to whether the server applied it.
const queueClears = new Map<string, Promise<boolean>>();

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isEmptyDraft = (draft: DraftRecord): boolean => (
  draft.text === '' && draft.queuedMessage === null
);

function readMirror(): Map<string, DraftRecord> {
  try {
    const raw = localStorage.getItem(MIRROR_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return new Map();
    }

    const restored = new Map<string, DraftRecord>();
    for (const [scope, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue;
      }
      restored.set(scope, {
        text: typeof value.text === 'string' ? value.text : '',
        queuedMessage: isRecord(value.queuedMessage)
          ? (value.queuedMessage as StoredQueuedMessage)
          : null,
      });
    }
    return restored;
  } catch {
    return new Map();
  }
}

function writeMirror(): void {
  try {
    localStorage.setItem(MIRROR_STORAGE_KEY, JSON.stringify(Object.fromEntries(drafts)));
  } catch {
    // A full localStorage costs the first-paint restore, not the draft: the
    // server copy is authoritative and arrives on hydrate.
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHAT_DRAFTS_CHANGED_EVENT));
  }
}

function flushServerWrites(): void {
  serverWriteTimer = null;
  const scopes = [...pendingScopes];

  for (const scope of scopes) {
    if (textRequests.has(scope)) continue;
    // Text only: the server keeps the scope's queued message as it is, and
    // drops the row itself once neither text nor a queued message is left.
    // Deleting the row from here would also delete a message queued from
    // another tab that this page has not heard about yet.
    const text = drafts.get(scope)?.text ?? '';
    const revision = textRevisions.get(scope) ?? 0;
    const generation = storeGeneration;
    const request: Promise<void> = Promise.resolve().then(async () => {
      try {
        if (generation !== storeGeneration) return;
        const response = await api.user.saveDraft(scope, { text });
        if (!response.ok) throw new Error(`Draft save failed (${response.status})`);
        if (generation === storeGeneration && textRevisions.get(scope) === revision) {
          pendingScopes.delete(scope);
        }
      } catch (error) {
        // Keep failed text dirty so the next poll cannot erase it. A later edit retries.
        console.error('Failed to save chat draft:', error);
      } finally {
        if (textRequests.get(scope) === request) {
          textRequests.delete(scope);
          if (pendingScopes.has(scope) && textRevisions.get(scope) !== revision) {
            queueServerWrite(scope);
          }
        }
      }
    });
    textRequests.set(scope, request);
  }
}

function queueServerWrite(scope: string): void {
  pendingScopes.add(scope);

  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
  }
  serverWriteTimer = setTimeout(flushServerWrites, SERVER_WRITE_DEBOUNCE_MS);
}

/** Applies a change to this page's copy of a draft; returns whether anything changed. */
function setLocalDraft(scope: string, update: Partial<DraftRecord>): boolean {
  const current = drafts.get(scope) ?? EMPTY_DRAFT;
  const next: DraftRecord = { ...current, ...update };

  if (next.text === current.text && next.queuedMessage === current.queuedMessage) {
    return false;
  }

  const nextDrafts = new Map(drafts);
  if (isEmptyDraft(next)) {
    nextDrafts.delete(scope);
  } else {
    nextDrafts.set(scope, next);
  }
  drafts = nextDrafts;

  writeMirror();
  notifyListeners();
  return true;
}

function noteQueueChanged(scope: string): void {
  queueRevisions.set(scope, (queueRevisions.get(scope) ?? 0) + 1);
}

/**
 * Sends a scope's queue request once the previous one has been answered, or at
 * once when none is outstanding (a clear must still beat the dispatcher's poll).
 */
function sendQueueRequest<T>(scope: string, send: () => Promise<T>): Promise<T> {
  const previous = queueRequests.get(scope);
  let request: Promise<T>;
  if (previous) {
    request = previous.then(send);
  } else {
    try {
      request = send();
    } catch (error) {
      request = Promise.reject(error);
    }
  }
  const settled = request.then(() => undefined, () => undefined);
  queueRequests.set(scope, settled);
  void settled.then(() => {
    if (queueRequests.get(scope) === settled) {
      queueRequests.delete(scope);
    }
  });
  return request;
}

/** A stored queued message in the shape the composer sends, or null when it has nothing to send. */
function normalizeQueuedMessage(queued: StoredQueuedMessage | null): StoredQueuedMessage | null {
  if (!queued || typeof queued.content !== 'string') {
    return null;
  }

  const attachments = Array.isArray(queued.attachments)
    ? queued.attachments
    : Array.isArray(queued.images)
      ? queued.images
      : [];

  // A queued message with neither text nor attachments has nothing to send.
  return queued.content.trim() || attachments.length > 0
    ? { ...queued, attachments }
    : null;
}

/**
 * Files attached to each scope's unsent message. They are browser File objects,
 * which cannot be written to the server or to localStorage, so this copy lives
 * in memory only: it lets an attachment survive leaving the chat (the composer
 * unmounting for Scheduled tasks or Plugins) and switching to another
 * conversation and back, but not a page reload. Cleared on sign-out.
 */
const draftAttachments = new Map<string, File[]>();
/** One shared empty list, so a scope without attachments always reads the same reference. */
const NO_ATTACHMENTS: File[] = [];

/** Used by chat's composer: the files attached to a scope's unsent message, oldest first. */
export function readDraftAttachments(scope: string): File[] {
  return draftAttachments.get(scope) ?? NO_ATTACHMENTS;
}

/** Used by chat's composer to remember (or, with an empty list, forget) a scope's attachments. */
export function writeDraftAttachments(scope: string, files: File[]): void {
  if (files.length > 0) {
    draftAttachments.set(scope, files);
  } else {
    draftAttachments.delete(scope);
  }
}

/** Reads one scope's composer text, synchronously, for the first render. */
export function readDraftText(scope: string): string {
  return drafts.get(scope)?.text ?? '';
}

export function writeDraftText(scope: string, text: string): void {
  if (readDraftText(scope) === text) return;
  textRevisions.set(scope, (textRevisions.get(scope) ?? 0) + 1);
  // Protect the change before notifying synchronous subscribers.
  pendingScopes.add(scope);
  setLocalDraft(scope, { text });
  queueServerWrite(scope);
}

export function readQueuedMessage(scope: string): StoredQueuedMessage | null {
  return normalizeQueuedMessage(drafts.get(scope)?.queuedMessage ?? null);
}

/**
 * Queues a message to send when the session is next idle, after anything
 * already queued for it, and resolves with the message that is now queued.
 *
 * The append happens on the server, against the stored message rather than
 * this page's copy of it: if the dispatcher has already taken the earlier
 * message to send, the new one is queued on its own, so nothing is sent twice
 * and nothing is lost. A clear made on this page goes to the server in order
 * with the appends around it. Rejects when the server did not accept the
 * message, so the composer can keep it instead of showing a card that will
 * never be sent; the ApiRequestError carries the server's error code, if any.
 */
export async function appendQueuedMessage(
  scope: string,
  message: StoredQueuedMessage,
): Promise<{ queuedMessage: StoredQueuedMessage; appended: boolean }> {
  for (;;) {
    const result = await sendQueueRequest(scope, async () => {
      const revisionAtRequest = queueRevisions.get(scope) ?? 0;
      const response = await api.user.appendQueuedMessage(scope, message);
      const payload = (await response.json().catch(() => null)) as {
        queuedMessage?: unknown;
        appended?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) {
        const errorCode = isRecord(payload?.error) ? payload.error.code : undefined;
        throw new ApiRequestError(readApiErrorMessage(payload) ?? `HTTP ${response.status}`, {
          code: typeof errorCode === 'string' ? errorCode : undefined,
          status: response.status,
        });
      }

      const queuedMessage = normalizeQueuedMessage(
        isRecord(payload?.queuedMessage) ? (payload?.queuedMessage as StoredQueuedMessage) : null,
      );
      if (!queuedMessage) {
        throw new Error('The server returned no queued message');
      }
      return {
        queuedMessage,
        appended: payload?.appended === true,
        clearedMeanwhile: (queueRevisions.get(scope) ?? 0) !== revisionAtRequest,
      };
    });

    // The queued message was edited or deleted on this page while the append
    // was in flight. That clear reaches the server after the append, so it
    // removes this message too: queue it again, behind the clear.
    if (result.clearedMeanwhile && await queueClears.get(scope)) {
      continue;
    }

    noteQueueChanged(scope);
    setLocalDraft(scope, { queuedMessage: result.queuedMessage });
    return { queuedMessage: result.queuedMessage, appended: result.appended };
  }
}

/** Removes a scope's queued message (edited back into the composer or deleted). */
export function clearQueuedMessage(scope: string): void {
  noteQueueChanged(scope);
  setLocalDraft(scope, { queuedMessage: null });
  // Sent at once unless an append is still being answered: editing or
  // cancelling must beat the server's next dispatcher poll.
  queueClears.set(scope, sendQueueRequest(scope, async () => {
    const response = await api.user.clearQueuedMessage(scope);
    return response.ok;
  }).catch((error: unknown) => {
    console.error('Failed to clear queued chat message:', error);
    return false;
  }));
}

/** Subscribes to any draft change; returns the unsubscribe function. */
export function subscribeToChatDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Loads the server's drafts and adopts them as the source of truth.
 *
 * A read cannot replace text with an unacknowledged save, or text edited since
 * the read began. Once settled, later reads may still adopt another device's draft.
 */
export async function hydrateChatDrafts(): Promise<void> {
  let serverDrafts: Array<{ scope?: unknown; text?: unknown; queuedMessage?: unknown }> = [];
  const queueRevisionsAtRequest = new Map(queueRevisions);
  const textRevisionsAtRequest = new Map(textRevisions);
  const pendingAtRequest = new Set(pendingScopes);
  const generation = storeGeneration;
  const sequence = ++hydrateSequence;

  try {
    const response = await api.user.drafts();
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { drafts?: unknown };
    if (!Array.isArray(payload.drafts)) {
      return;
    }
    serverDrafts = payload.drafts as typeof serverDrafts;
  } catch (error) {
    // Keep the mirror: an offline load must still show what was typed here.
    console.error('Failed to load chat drafts:', error);
    return;
  }

  if (generation !== storeGeneration || sequence < lastAppliedHydrate) return;
  lastAppliedHydrate = sequence;
  const merged = new Map<string, DraftRecord>();
  for (const draft of serverDrafts) {
    const scope = typeof draft.scope === 'string' ? draft.scope : '';
    if (!scope) {
      continue;
    }

    merged.set(scope, {
      text: typeof draft.text === 'string' ? draft.text : '',
      queuedMessage: isRecord(draft.queuedMessage)
        ? (draft.queuedMessage as StoredQueuedMessage)
        : null,
    });
  }

  // Local changes the snapshot cannot contain yet win over it, field by field:
  // text awaiting acknowledgement or edited since the snapshot began, and a queued message
  // this page changed while the request was in flight. Otherwise the server's
  // queued message wins even for a scope being typed into, which is how this
  // page learns the dispatcher has sent it. Every other missing scope was
  // deleted remotely and must also disappear from the mirror.
  const queueChangedDuringRequest = (scope: string) => (
    (queueRevisions.get(scope) ?? 0) !== (queueRevisionsAtRequest.get(scope) ?? 0)
  );
  const keepLocalText = (scope: string) => (
    pendingScopes.has(scope) || pendingAtRequest.has(scope)
    || (textRevisions.get(scope) ?? 0) !== (textRevisionsAtRequest.get(scope) ?? 0)
  );
  const locallyChangedScopes = new Set([
    ...pendingScopes,
    ...pendingAtRequest,
    ...[...textRevisions.keys()].filter(keepLocalText),
    ...[...queueRevisions.keys()].filter(queueChangedDuringRequest),
  ]);
  for (const scope of locallyChangedScopes) {
    const local = drafts.get(scope) ?? EMPTY_DRAFT;
    const server = merged.get(scope) ?? EMPTY_DRAFT;
    const next: DraftRecord = {
      text: keepLocalText(scope) ? local.text : server.text,
      queuedMessage: queueChangedDuringRequest(scope) ? local.queuedMessage : server.queuedMessage,
    };
    if (isEmptyDraft(next)) {
      merged.delete(scope);
    } else {
      merged.set(scope, next);
    }
  }

  drafts = merged;
  writeMirror();
  notifyListeners();
}

/** Drops every cached draft on sign-out, so the next user sees none of them. */
export function resetChatDrafts(): void {
  storeGeneration += 1;
  lastAppliedHydrate = 0;
  drafts = new Map();
  draftAttachments.clear();
  pendingScopes.clear();
  textRevisions.clear();
  textRequests.clear();
  queueRevisions.clear();
  queueRequests.clear();
  queueClears.clear();
  if (serverWriteTimer !== null) {
    clearTimeout(serverWriteTimer);
    serverWriteTimer = null;
  }
  try {
    localStorage.removeItem(MIRROR_STORAGE_KEY);
  } catch {
    // The in-memory copy is already cleared, which is what readers use.
  }
  notifyListeners();
}

// Read at module load rather than on first use, because the composer's initial
// input value is a `useState` initializer that runs before any effect.
if (typeof localStorage !== 'undefined') {
  drafts = readMirror();
}

/** Used by the composer to interrupt and send the server-owned queue after pending local appends settle. */
export async function sendQueuedMessageNow(scope: string): Promise<void> {
  await sendQueueRequest(scope, async () => {
    const response = await api.user.sendQueuedMessageNow(scope);
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new ApiRequestError(readApiErrorMessage(payload) ?? ('HTTP ' + response.status), { status: response.status });
    }
    noteQueueChanged(scope);
    setLocalDraft(scope, { queuedMessage: null });
  });
}

/** Saves queue text in place, retaining already-uploaded attachments even after a browser reload. */
export async function changeQueuedMessage(scope: string, expectedContent: string, content: string | null): Promise<void> {
  await sendQueueRequest(scope, async () => {
    const response = await api.user.changeQueuedMessage(scope, expectedContent, content);
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new ApiRequestError(readApiErrorMessage(payload) ?? ('HTTP ' + response.status), { status: response.status });
    noteQueueChanged(scope);
    setLocalDraft(scope, { queuedMessage: normalizeQueuedMessage(payload?.queuedMessage) });
  });
}

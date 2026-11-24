import { useSyncExternalStore } from 'react';

/**
 * The background tasks each session has running, as the chat has worked them
 * out, for views outside the chat that list them (the workspace inspector).
 *
 * The chat is the only place that knows the full list while a turn is still
 * going — the running-sessions poll only reports tasks once the turn has
 * ended — so its task strip publishes here and the inspector reads it back.
 */

/** One running task, already described in the reader's language. */
export type SessionTaskEntry = {
  /** Stable key: the launching tool call, or the task id when no row is loaded. */
  id: string;
  /** What `chat.stop-task` addresses; absent until the task has been named. */
  taskId?: string;
  /** "Workflow", "Agent" or "Command". */
  kind: string;
  name: string;
  /** Epoch ms the task started, for its elapsed time. */
  startedAt: number;
};

type SessionTasks = {
  entries: SessionTaskEntry[];
  /** Stops one task of the session; absent before the session exists. */
  stop?: (taskId: string) => void;
};

const NO_TASKS: SessionTasks = { entries: [] };
const tasksBySession = new Map<string, SessionTasks>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const entriesKey = (entries: SessionTaskEntry[]) => JSON.stringify(entries);

/**
 * Used by chat's BackgroundTasksStrip whenever the list it draws changes. An
 * empty list removes the session; publishing the same list again is a no-op,
 * so readers only re-render on a real change.
 */
export function publishSessionTasks(sessionId: string, entries: SessionTaskEntry[], stop?: (taskId: string) => void): void {
  const previous = tasksBySession.get(sessionId);
  if (entries.length === 0) {
    if (!previous) return;
    tasksBySession.delete(sessionId);
  } else {
    if (previous && entriesKey(previous.entries) === entriesKey(entries) && previous.stop === stop) return;
    tasksBySession.set(sessionId, { entries, stop });
  }
  listeners.forEach((notify) => notify());
}

/** Used by the workspace inspector: the session's running tasks, empty when there are none. */
export function useSessionTasks(sessionId: string | null): SessionTasks {
  const read = () => (sessionId ? tasksBySession.get(sessionId) ?? NO_TASKS : NO_TASKS);
  return useSyncExternalStore(subscribe, read, read);
}

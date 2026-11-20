import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerEvent } from '@/shared/types';

type AbortFeedback = 'stopping' | 'timeout' | 'failed' | 'disconnected';

/** Used by ChatInterface to acknowledge Stop immediately without declaring the backend run idle. */
export function useChatAbortFeedback({ sessionId, isProcessing, canAbort, isConnected, abort, subscribe }: {
  sessionId: string | null;
  isProcessing: boolean;
  canAbort: boolean;
  isConnected: boolean;
  abort: () => void;
  subscribe: (listener: (event: ServerEvent) => void) => () => void;
}) {
  // Stop requests outlive navigation; only their own session may settle or display their feedback.
  const [feedback, setFeedback] = useState<Map<string, AbortFeedback>>(() => new Map());
  const feedbackRef = useRef(feedback);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const update = useCallback((id: string, status?: AbortFeedback) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    const next = new Map(feedbackRef.current);
    if (status) next.set(id, status); else next.delete(id);
    feedbackRef.current = next;
    setFeedback(next);
  }, []);

  useEffect(() => subscribe(event => {
    const id = event.sessionId;
    if (!id || !feedbackRef.current.has(id)) return;
    if (event.kind === 'complete') {
      update(id, event.aborted && typeof event.exitCode === 'number' && event.exitCode !== 0 ? 'failed' : undefined);
    } else if (event.kind === 'protocol_error' && feedbackRef.current.get(id) === 'stopping' && event.code !== 'NO_SUCH_TASK' && event.code !== 'TASK_ID_REQUIRED') {
      update(id, 'failed');
    }
  }), [subscribe, update]);

  useEffect(() => {
    if (!isConnected) {
      for (const [id, status] of feedbackRef.current) if (status === 'stopping') update(id, 'disconnected');
    }
  }, [isConnected, update]);

  useEffect(() => {
    if (sessionId && !isProcessing && feedbackRef.current.get(sessionId) === 'stopping') update(sessionId);
    else if (sessionId && isProcessing && feedbackRef.current.has(sessionId) && feedbackRef.current.get(sessionId) !== 'stopping') update(sessionId);
  }, [sessionId, isProcessing, update]);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => { for (const timer of pendingTimers.values()) clearTimeout(timer); };
  }, []);

  const requestAbort = useCallback(() => {
    if (!sessionId || !canAbort || feedbackRef.current.get(sessionId) === 'stopping') return;
    if (!isConnected) { update(sessionId, 'disconnected'); return; }
    update(sessionId, 'stopping');
    // No completion is inferred from elapsed time. Release the button for a retry and explain the uncertainty.
    timers.current.set(sessionId, setTimeout(() => update(sessionId, 'timeout'), 15_000));
    try { abort(); } catch { update(sessionId, 'failed'); }
  }, [sessionId, canAbort, isConnected, abort, update]);

  const status = sessionId ? feedback.get(sessionId) : undefined;
  return { requestAbort, isStopping: status === 'stopping', stopError: status && status !== 'stopping' ? status : null };
}

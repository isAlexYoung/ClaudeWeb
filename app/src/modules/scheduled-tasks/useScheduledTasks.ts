import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import type { ScheduledTask } from '@/shared/types';

/** Reads an API error body into one line for the page. */
export async function readApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    const error = payload?.error;
    return (typeof error === 'string' ? error : error?.message) || response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * The user's scheduled tasks, read on mount and again whenever the server
 * announces a change (`scheduled_tasks_changed`: a run started or finished, or
 * another tab edited the list) or the socket reconnects.
 */
export function useScheduledTasks() {
  const { subscribe } = useWebSocket();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the newest answer is shown; announcements can arrive back to back.
  const latestRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequestRef.current;
    try {
      const response = await api.scheduledTasks.list();
      if (!response.ok) throw new Error(await readApiError(response));
      const payload = await response.json();
      if (request !== latestRequestRef.current) return;
      setTasks(Array.isArray(payload?.data) ? payload.data : []);
      setError(null);
    } catch (caught) {
      if (request === latestRequestRef.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (request === latestRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => subscribe((event) => {
    if (event.kind === 'scheduled_tasks_changed' || event.kind === 'websocket_reconnected') void refresh();
  }), [refresh, subscribe]);

  return { tasks, loading, error, refresh };
}

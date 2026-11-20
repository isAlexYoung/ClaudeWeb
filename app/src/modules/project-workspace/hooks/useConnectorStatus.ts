import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { McpConnectionStatus } from '@/shared/types';

/** Used by WorkspaceContextInspector to refresh live state only while its connector disclosure is open. */
export function useConnectorStatus(workspacePath: string | undefined, sessionId: string | undefined, enabled: boolean) {
  // Each async result carries its workspace/session, so navigation cannot display stale badges.
  const [snapshot, setSnapshot] = useState<{ key: string; servers: McpConnectionStatus[]; error: boolean } | null>(null);
  const key = JSON.stringify([workspacePath, sessionId]);
  useEffect(() => {
    if (!enabled || !workspacePath) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    const refresh = async () => {
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 10000);
      try {
        const response = await api.providers.mcpConnections('claude', { workspacePath, sessionId }, { signal: request.signal });
        if (!response.ok) throw new Error(`MCP status request failed: ${response.status}`);
        const payload = await response.json();
        const collection: unknown = payload.data?.servers;
        if (!Array.isArray(collection)) throw new Error('Invalid MCP status response');
        const statuses = collection.filter((entry): entry is McpConnectionStatus => entry && typeof entry.name === 'string'
          && ['connected', 'disconnected', 'connecting'].includes(entry.status));
        if (!cancelled) setSnapshot({ key, servers: statuses, error: false });
      } catch {
        if (!cancelled) setSnapshot({ key, servers: [], error: true });
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(() => void refresh(), 5000);
      }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); request?.abort(); };
  }, [workspacePath, sessionId, enabled, key]);
  return enabled && snapshot?.key === key ? { servers: snapshot.servers, error: snapshot.error } : { servers: [], error: false };
}

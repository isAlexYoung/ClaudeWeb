import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { ProjectMemorySnapshot } from '@/shared/types';

async function decode(request: Promise<Response>): Promise<ProjectMemorySnapshot> {
  const response = await request;
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.code || body?.code || 'MEMORY_FAILED');
  return body;
}

/** Used by the editor and inspector; background reads never replace an editor's captured write version. */
export function useProjectMemory(projectId: string | null, watch: boolean) {
  // Scope travels with loaded data so switching projects never exposes the previous project's list.
  const [state, setState] = useState<{ scope: string | null; data: ProjectMemorySnapshot | null; loading: boolean; error: string }>({ scope: projectId, data: null, loading: false, error: '' });
  const current = useRef(projectId); current.current = projectId;
  const ticket = useRef(0);
  const refresh = useCallback(async () => {
    if (!projectId) return null;
    const request = ++ticket.current;
    // Polls keep the existing rows in place. Only the first read needs a loading row.
    setState(previous => previous.scope === projectId && previous.data
      ? previous
      : { scope: projectId, data: null, loading: true, error: '' });
    try {
      const data = await decode(api.projectMemory.list(projectId));
      if (current.current === projectId && ticket.current === request) setState(previous =>
        previous.scope === projectId && !previous.loading && !previous.error && JSON.stringify(previous.data) === JSON.stringify(data)
          ? previous
          : { scope: projectId, data, loading: false, error: '' });
      return data;
    } catch (error) {
      if (current.current === projectId && ticket.current === request) setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : 'MEMORY_FAILED' }));
      return null;
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
    if (!watch || !projectId) return;
    const updated = (event: Event) => { if ((event as CustomEvent).detail?.projectId === projectId) void refresh(); };
    const focus = () => { void refresh(); };
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 10_000);
    window.addEventListener('claudeweb:memory-updated', updated); window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('claudeweb:memory-updated', updated); window.removeEventListener('focus', focus); };
  }, [projectId, watch, refresh]);
  return {
    ...(state.scope === projectId ? state : { data: null, loading: !!projectId, error: '' }), refresh,
    save: async (request: Promise<Response>) => {
      const data = await decode(request);
      if (current.current === projectId) { ticket.current++; setState({ scope: projectId, data, loading: false, error: '' }); }
      window.dispatchEvent(new CustomEvent('claudeweb:memory-updated', { detail: { projectId } }));
      return data;
    },
  };
}

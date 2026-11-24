import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import type { ArtefactSummary } from '@/shared/types';

/** The kinds that can be created and opened in an editor. */
export type EditableArtefactKind = 'sheet' | 'doc' | 'whiteboard';

type ArtefactChangeEvent = {
  upsert?: ArtefactSummary;
  removeId?: string;
};
type ArtefactsListener = (event?: ArtefactChangeEvent) => void;
const artefactsListeners = new Set<ArtefactsListener>();
const cachedArtefactsById = new Map<string, ArtefactSummary>();

/** Synchronous lookup of the latest known artefact metadata (e.g. its linked sessionId). */
export function getCachedArtefact(id: string | null | undefined): ArtefactSummary | null {
  if (!id) return null;
  return cachedArtefactsById.get(id) ?? null;
}

/** Tells every mounted artefacts consumer (page, sidebar, chat card) to update immediately and refresh. */
export function notifyArtefactsChanged(event?: ArtefactChangeEvent): void {
  if (event?.removeId) cachedArtefactsById.delete(event.removeId);
  if (event?.upsert?.id) cachedArtefactsById.set(event.upsert.id, event.upsert);
  for (const listener of artefactsListeners) listener(event);
}

function subscribeArtefactsChanged(listener: ArtefactsListener): () => void {
  artefactsListeners.add(listener);
  return () => { artefactsListeners.delete(listener); };
}

function applyArtefactEvent(current: ArtefactSummary[] | null, event?: ArtefactChangeEvent): ArtefactSummary[] | null {
  if (!event) return current;
  if (event.removeId) {
    return current ? current.filter((item) => item.id !== event.removeId) : current;
  }
  if (event.upsert?.id) {
    const incoming = event.upsert;
    const list = current ?? [];
    const index = list.findIndex((item) => item.id === incoming.id);
    if (index === -1) return [incoming, ...list];
    const next = [...list];
    next[index] = { ...next[index], ...incoming };
    return next;
  }
  return current;
}

/** The `{ success, data }` envelope's data, or the API's error message. */
export async function readArtefactResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { data?: T } | null;
  if (!response.ok) {
    const error = new Error(readApiErrorMessage(body) ?? `HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return body?.data as T;
}

/**
 * Used by ArtefactsPage: the signed-in user's artefacts and the actions on
 * them. Every change re-reads the list, which is small, so the page never
 * shows a guess of what the server holds.
 */
export function useArtefacts() {
  // Null until the first read lands, so the page can tell "loading" from "none".
  const [artefacts, setArtefacts] = useState<ArtefactSummary[] | null>(null);
  // The last failure, shown above the list until the next successful read.
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (typeof api.artefacts?.list !== 'function') {
      setArtefacts([]);
      return;
    }
    try {
      const list = await readArtefactResponse<ArtefactSummary[]>(await api.artefacts.list());
      cachedArtefactsById.clear();
      for (const item of list) cachedArtefactsById.set(item.id, item);
      setArtefacts(list);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setArtefacts((current) => current ?? []);
    }
  }, []);

  // The first read starts once the page has mounted, and re-runs whenever another surface mutates artefacts.
  useEffect(() => {
    queueMicrotask(() => void reload());
    return subscribeArtefactsChanged((event) => {
      if (event) setArtefacts((current) => applyArtefactEvent(current, event));
      void reload();
    });
  }, [reload]);

  const createArtefact = useCallback(async (kind: EditableArtefactKind, title: string) => {
    const created = await readArtefactResponse<ArtefactSummary>(await api.artefacts.create({ kind, title }));
    notifyArtefactsChanged({ upsert: created });
    await reload();
    return created;
  }, [reload]);

  const update = useCallback(async (id: string, fields: { title?: string; pinned?: boolean }) => {
    let updated: ArtefactSummary | undefined;
    try {
      updated = await readArtefactResponse<ArtefactSummary>(await api.artefacts.update(id, fields));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    notifyArtefactsChanged(updated ? { upsert: updated } : undefined);
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    try {
      await readArtefactResponse<unknown>(await api.artefacts.remove(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    notifyArtefactsChanged({ removeId: id });
    await reload();
  }, [reload]);

  return { artefacts, error, reload, createArtefact, update, remove };
}

/** Used by the sidebar to mark conversations owned by an artefact with the Artefacts icon. */
export function useArtefactSessionIds(): Set<string> {
  const { artefacts } = useArtefacts();
  return useMemo(
    () => new Set((artefacts ?? []).map((item) => item.sessionId).filter((id): id is string => Boolean(id))),
    [artefacts],
  );
}

/** Used by ChatInterface to display a minimized artefact card at the top of its conversation. */
export function useArtefactBySessionId(sessionId: string | null | undefined): ArtefactSummary | null {
  const { artefacts } = useArtefacts();
  return useMemo(() => {
    if (!sessionId || !artefacts) return null;
    return artefacts.find((item) => item.sessionId === sessionId) ?? null;
  }, [artefacts, sessionId]);
}

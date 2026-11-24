import { useCallback, useEffect, useState } from 'react';

import { api, readApiErrorMessage } from '@/shared/api';
import type { ArtefactSummary } from '@/shared/types';

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
    try {
      const list = await readArtefactResponse<ArtefactSummary[]>(await api.artefacts.list());
      setArtefacts(list);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setArtefacts((current) => current ?? []);
    }
  }, []);

  // The first read starts once the page has mounted.
  useEffect(() => { queueMicrotask(() => void reload()); }, [reload]);

  const createSheet = useCallback(async (title: string) => {
    const created = await readArtefactResponse<ArtefactSummary>(await api.artefacts.create({ kind: 'sheet', title }));
    await reload();
    return created;
  }, [reload]);

  const update = useCallback(async (id: string, fields: { title?: string; pinned?: boolean }) => {
    try {
      await readArtefactResponse<ArtefactSummary>(await api.artefacts.update(id, fields));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    await reload();
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    try {
      await readArtefactResponse<unknown>(await api.artefacts.remove(id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    await reload();
  }, [reload]);

  return { artefacts, error, reload, createSheet, update, remove };
}

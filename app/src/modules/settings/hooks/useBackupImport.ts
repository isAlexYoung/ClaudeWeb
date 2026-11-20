import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { BackupImportStatus } from '@/shared/types';

const POLL_INTERVAL_MS = 1000;
const UPLOAD_ATTEMPTS = 3;

type BackupImportView =
  | { step: 'idle' }
  | { step: 'uploading'; sentBytes: number; totalBytes: number }
  | { step: 'server'; status: BackupImportStatus };

class BackupRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function errorCodeOf(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: { code?: unknown } };
    return typeof data?.error?.code === 'string' ? data.error.code : 'BACKUP_REQUEST_FAILED';
  } catch {
    return 'BACKUP_REQUEST_FAILED';
  }
}

async function readStatus(response: Response): Promise<BackupImportStatus> {
  if (!response.ok) throw new BackupRequestError(await errorCodeOf(response));
  return await response.json() as BackupImportStatus;
}

/** Sends one piece, retrying dropped connections and temporary gateway errors. */
async function uploadChunk(importId: string, index: number, chunk: Blob): Promise<void> {
  let lastCode = 'BACKUP_NETWORK';
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await api.backup.uploadChunk(importId, index, chunk);
    } catch {
      lastCode = 'BACKUP_NETWORK';
      continue;
    }
    if (response.ok) return;
    lastCode = await errorCodeOf(response);
    if (response.status < 500) break;
  }
  throw new BackupRequestError(lastCode);
}

/**
 * Drives one backup import for the settings backup tab: uploads the file in
 * pieces, then follows the server through reading, password, preview and
 * import by polling its status.
 */
export function useBackupImport() {
  // Which step the tab shows; after the upload it mirrors the server's status.
  const [view, setView] = useState<BackupImportView>({ step: 'idle' });
  // A failure in the browser or a refused request, shown above the drop zone.
  const [requestError, setRequestError] = useState<string | null>(null);
  const importIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  const fail = useCallback((error: unknown) => {
    setRequestError(error instanceof BackupRequestError ? error.code : 'BACKUP_NETWORK');
  }, []);

  useEffect(() => () => {
    // Leaving the tab stops the upload loop; the server drops the partial file later.
    cancelledRef.current = true;
  }, []);

  const serverState = view.step === 'server' ? view.status.state : null;
  useEffect(() => {
    if (serverState !== 'reading' && serverState !== 'importing') return undefined;
    const timer = window.setTimeout(() => {
      const importId = importIdRef.current;
      if (!importId) return;
      api.backup.status(importId)
        .then(readStatus)
        .then((status) => {
          if (!cancelledRef.current) setView({ step: 'server', status });
        })
        .catch((error: unknown) => {
          if (cancelledRef.current) return;
          fail(error);
          // Keep polling: a dropped request does not stop the server-side step.
          setView((current) => (current.step === 'server' ? { step: 'server', status: { ...current.status } } : current));
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [view, serverState, fail]);

  const start = useCallback(async (file: File) => {
    cancelledRef.current = false;
    importIdRef.current = null;
    setRequestError(null);
    setView({ step: 'uploading', sentBytes: 0, totalBytes: file.size });
    try {
      const created = await api.backup.createImport(file.size);
      if (!created.ok) throw new BackupRequestError(await errorCodeOf(created));
      const { importId, chunkSize } = await created.json() as { importId: string; chunkSize: number };
      importIdRef.current = importId;
      for (let index = 0, offset = 0; offset < file.size; index += 1, offset += chunkSize) {
        if (cancelledRef.current) return;
        await uploadChunk(importId, index, file.slice(offset, offset + chunkSize));
        if (cancelledRef.current) return;
        setView({ step: 'uploading', sentBytes: Math.min(offset + chunkSize, file.size), totalBytes: file.size });
      }
      const status = await readStatus(await api.backup.preview(importId));
      if (!cancelledRef.current) setView({ step: 'server', status });
    } catch (error) {
      if (cancelledRef.current) return;
      fail(error);
      setView({ step: 'idle' });
    }
  }, [fail]);

  const submitPassword = useCallback(async (password: string) => {
    const importId = importIdRef.current;
    if (!importId) return;
    setRequestError(null);
    try {
      setView({ step: 'server', status: await readStatus(await api.backup.preview(importId, password)) });
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  const apply = useCallback(async (projectIds: string[]) => {
    const importId = importIdRef.current;
    if (!importId) return;
    setRequestError(null);
    try {
      setView({ step: 'server', status: await readStatus(await api.backup.apply(importId, projectIds)) });
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  const reset = useCallback(() => {
    const importId = importIdRef.current;
    cancelledRef.current = true;
    importIdRef.current = null;
    setRequestError(null);
    setView({ step: 'idle' });
    // Best effort: a finished import has already removed its upload.
    if (importId) void api.backup.cancel(importId).catch(() => undefined);
  }, []);

  return { view, requestError, start, submitPassword, apply, reset };
}

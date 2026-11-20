import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError, api, readApiJson } from '@/shared/api';
import type { ClaudeWebUpdateCheck, ClaudeWebUpdateState, ClaudeWebUpdateStatus } from '@/shared/types';

const POLL_MS = 2000;
// The updater rewrites its status at every step; one this old belongs to an earlier run.
const STALE_SECONDS = 30 * 60;
const ACTIVE: ClaudeWebUpdateState[] = ['queued', 'checking', 'downloading', 'installing', 'restarting'];

export type ClaudeWebUpdatePhase = 'loading' | 'ready' | 'checking' | 'starting' | 'updating' | 'reloading';

function errorCode(error: unknown): string {
  return error instanceof ApiRequestError && error.code ? error.code : 'CLAUDEWEB_UPDATE_FAILED';
}

function isActive(status: ClaudeWebUpdateStatus['status'] | undefined, nowSeconds: number) {
  return Boolean(status && ACTIVE.includes(status.state) && (!status.updated_at || nowSeconds - status.updated_at < STALE_SECONDS));
}

/**
 * Used by Settings > About to check for and install a newer prebuilt ClaudeWeb. Root does the
 * work; this follows its status file and reloads the page once the new version answers, keeping
 * on polling while the service restarts underneath it.
 */
export function useClaudeWebUpdate(reload: () => void = () => window.location.reload()) {
  const [phase, setPhase] = useState<ClaudeWebUpdatePhase>('loading');
  const [status, setStatus] = useState<ClaudeWebUpdateStatus | null>(null);
  const [offer, setOffer] = useState<ClaudeWebUpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const poll = useCallback(async function pollStatus(): Promise<void> {
    if (!alive.current) return;
    try {
      const next = await readApiJson<ClaudeWebUpdateStatus>(await api.claudewebUpdate.status());
      if (!alive.current) return;
      setStatus(next);
      const wanted = target.current ?? next.status.version ?? null;
      if (next.status.state === 'done' && wanted && next.installed === wanted) {
        setPhase('reloading');
        timer.current = setTimeout(reload, 1500);
        return;
      }
      if (next.status.state === 'failed') {
        setError(next.status.error ?? 'CLAUDEWEB_UPDATE_FAILED');
        setPhase('ready');
        target.current = null;
        return;
      }
    } catch {
      // ClaudeWeb itself restarts during the update; keep asking until it answers again.
    }
    if (alive.current) timer.current = setTimeout(() => void pollStatus(), POLL_MS);
  }, [reload]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const first = await readApiJson<ClaudeWebUpdateStatus>(await api.claudewebUpdate.status());
        if (!alive.current) return;
        setStatus(first);
        if (isActive(first.status, Date.now() / 1000)) {
          target.current = first.status.version ?? null;
          setPhase('updating');
          timer.current = setTimeout(() => void poll(), POLL_MS);
        } else setPhase('ready');
      } catch {
        if (alive.current) setPhase('ready');
      }
    })();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  const check = useCallback(async () => {
    setError(null);
    setPhase('checking');
    try {
      setOffer(await readApiJson<ClaudeWebUpdateCheck>(await api.claudewebUpdate.check()));
    } catch (caught) {
      setError(errorCode(caught));
    }
    setPhase('ready');
  }, []);

  const update = useCallback(async (version: string) => {
    setError(null);
    setPhase('starting');
    try {
      await readApiJson(await api.claudewebUpdate.update(version));
      target.current = version;
      setPhase('updating');
      timer.current = setTimeout(() => void poll(), POLL_MS);
    } catch (caught) {
      // That version is already installed (an earlier click, or another tab, finished the
      // update): check again so the page says it is up to date instead of showing an error.
      if (errorCode(caught) === 'CLAUDEWEB_NOT_NEWER') {
        await check();
        return;
      }
      setError(errorCode(caught));
      setPhase('ready');
    }
  }, [check, poll]);

  return { phase, status, offer, error, check, update };
}

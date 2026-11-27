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

// Module-level so the default stays the same function on every render: an inline default
// made `poll` (and the effect depending on it) change each render, and the effect's cleanup
// then cancelled the pending reload right after the update finished.
function reloadPage() {
  window.location.reload();
}

/**
 * Used by Settings > About to check for and install a newer prebuilt ClaudeWeb. Root does the
 * work; this follows its status file and reloads the page once the new version answers, keeping
 * on polling while the service restarts underneath it.
 */
export function useClaudeWebUpdate(reload: () => void = reloadPage) {
  const [phase, setPhase] = useState<ClaudeWebUpdatePhase>('loading');
  const [status, setStatus] = useState<ClaudeWebUpdateStatus | null>(null);
  const [offer, setOffer] = useState<ClaudeWebUpdateCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  const schedule = useCallback((run: () => void, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  }, []);

  const poll = useCallback(async function pollStatus(): Promise<void> {
    if (!alive.current) return;
    try {
      const next = await readApiJson<ClaudeWebUpdateStatus>(await api.claudewebUpdate.status());
      if (!alive.current) return;
      setStatus(next);
      const wanted = target.current ?? next.status.version ?? null;
      // The new version answering is what matters; `done` is written just after it does.
      if (wanted && next.installed === wanted && (next.status.state === 'done' || !ACTIVE.includes(next.status.state))) {
        setOffer(null);
        setPhase('reloading');
        schedule(() => reloadRef.current(), 1500);
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
    if (alive.current) schedule(() => void pollStatus(), POLL_MS);
  }, [schedule]);

  const follow = useCallback((version: string | null) => {
    target.current = version;
    setPhase('updating');
    schedule(() => void poll(), POLL_MS);
  }, [poll, schedule]);

  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const first = await readApiJson<ClaudeWebUpdateStatus>(await api.claudewebUpdate.status());
        if (!alive.current) return;
        setStatus(first);
        if (isActive(first.status, Date.now() / 1000)) {
          follow(first.status.version ?? null);
        } else {
          // A rejected package can finish before About opens (or the page reloads).
          // Keep its explanation visible even though no update is active now.
          if (first.status.state === 'failed') setError(first.status.error ?? 'CLAUDEWEB_UPDATE_FAILED');
          setPhase('ready');
        }
      } catch {
        if (alive.current) setPhase('ready');
      }
    })();
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [follow]);

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
      follow(version);
    } catch (caught) {
      const code = errorCode(caught);
      // That version is already installed (an earlier click, or another tab, finished the
      // update): check again so the page says it is up to date instead of showing an error.
      if (code === 'CLAUDEWEB_NOT_NEWER') {
        try {
          setStatus(await readApiJson<ClaudeWebUpdateStatus>(await api.claudewebUpdate.status()));
        } catch {
          // The check below still says whether anything newer is left.
        }
        await check();
        return;
      }
      // Another tab (or an earlier click) already started it: follow that run instead.
      if (code === 'CLAUDEWEB_UPDATE_RUNNING') {
        try {
          const now = await readApiJson<ClaudeWebUpdateStatus>(await api.claudewebUpdate.status());
          setStatus(now);
          if (isActive(now.status, Date.now() / 1000)) {
            follow(now.status.version ?? version);
            return;
          }
        } catch {
          // Fall through to the error below.
        }
      }
      setError(code);
      setPhase('ready');
    }
  }, [check, follow]);

  return { phase, status, offer, error, check, update, reload: () => reloadRef.current() };
}

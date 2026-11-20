import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '@/shared/api';

type QuotaLimit = { kind: string; label: string; percent: number; resetsAt: string | null };

type QuotaReading = {
  limits: QuotaLimit[];
  plan: string | null;
  /** True when the limits are the last successful reading, kept while a refresh failed. */
  stale: boolean;
  /** The plugin's or the request's own error text, shown as reported; null when the reading is fine. */
  error: string | null;
  loading: boolean;
};

type QuotaValue = QuotaReading & { refresh: () => void };

const Context = createContext<QuotaValue | null>(null);

// The plugin caches the upstream usage API; polling faster only returns the same reading.
const REFRESH_INTERVAL_MS = 5 * 60_000;

/** Mounted by the workspace route; one poll of the Claude Usage plugin serves the composer ring and the usage dialogs. */
export function SubscriptionQuotaProvider({ children }: { children: ReactNode }) {
  // The last successful reading is kept while a refresh fails or backs off.
  const [reading, setReading] = useState<QuotaReading>({ limits: [], plan: null, stale: false, error: null, loading: true });

  const inflight = useRef<Promise<void> | null>(null);
  const readQuota = useCallback((force = false) => {
    if (inflight.current) return;
    setReading(previous => ({ ...previous, loading: true }));
    inflight.current = api.plugins.rpc('claude-usage', 'GET', force ? '/live?refresh=1' : '/live').then(async (response) => {
      const data = await response.json() as { limits?: QuotaLimit[]; plan?: string; stale?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const limits = (data.limits || []).filter((limit) => typeof limit.percent === 'number' && Number.isFinite(limit.percent));
      setReading({ limits, plan: data.plan || null, stale: Boolean(data.stale), error: data.error || null, loading: false });
    }).catch((error: unknown) => {
      setReading((previous) => ({
        ...previous,
        stale: previous.limits.length > 0,
        error: error instanceof Error ? error.message : String(error),
        loading: false,
      }));
    }).finally(() => { inflight.current = null; });
  }, []);
  const refresh = useCallback(() => readQuota(true), [readQuota]);

  useEffect(() => {
    readQuota();
    const timer = setInterval(() => readQuota(), REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [readQuota]);

  const value = useMemo(() => ({ ...reading, refresh }), [reading, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Used by the shared QuotaRing and QuotaDetails to read the Claude Usage plugin's live plan limits. */
export function useSubscriptionQuota() {
  const value = useContext(Context);
  if (!value) throw new Error('SubscriptionQuotaProvider is required');
  return value;
}

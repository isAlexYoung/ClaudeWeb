import { useCallback, useEffect, useState } from 'react';

/** One WebDesktop login as the entry gateway reports it; `ref` stands for the login, never its session id. */
export type LoginDevice = {
  ref: string;
  device: string;
  via: 'desktop' | 'claudeweb' | 'cmcp' | string;
  ip: string;
  at: number;
  main: boolean;
  current: boolean;
};

export type LoginDeviceList = { logins: LoginDevice[]; max: number };

// Served by WebDesktop's entry gateway in front of ClaudeWeb, next to the login pages.
const DEVICES_URL = `${import.meta.env.BASE_URL}__webdesktop/devices`;

export async function fetchLoginDevices(fetcher: typeof fetch = fetch): Promise<LoginDeviceList | null> {
  const response = await fetcher(DEVICES_URL, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as Partial<LoginDeviceList> | null;
  if (!data || !Array.isArray(data.logins)) return null;
  return { logins: data.logins, max: typeof data.max === 'number' ? data.max : 3 };
}

/** Signs another device out. Resolves false when it was already gone or the gateway refused. */
export async function endLoginDevice(ref: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(DEVICES_URL, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'end', ref }),
  });
  return response.ok;
}

/**
 * The WebDesktop logins, refreshed every `intervalMs`. `list` stays null when
 * ClaudeWeb is not behind WebDesktop's gateway (or it does not answer).
 */
export function useLoginDevices(intervalMs: number) {
  const [list, setList] = useState<LoginDeviceList | null>(null);
  const refresh = useCallback(async () => {
    try {
      setList(await fetchLoginDevices());
    } catch {
      // Offline for a moment: keep what was shown.
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, intervalMs]);
  return { list, refresh };
}

export function loginAge(at: number, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!at) return t('about.devices.earlier');
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return t('about.devices.justNow');
  if (minutes < 60) return t('about.devices.minutesAgo', { count: minutes });
  return new Date(at).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function loginDetails(login: LoginDevice, t: (key: string, options?: Record<string, unknown>) => string) {
  const via = ['desktop', 'claudeweb', 'cmcp'].includes(login.via) ? t(`about.devices.via.${login.via}`) : login.via;
  return [via, login.ip, loginAge(login.at, t)].filter(Boolean).join(' · ');
}

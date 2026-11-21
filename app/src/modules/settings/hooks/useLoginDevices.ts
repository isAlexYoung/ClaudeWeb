import { useCallback, useEffect, useState } from 'react';

import { api } from '@/shared/api';

/** One signed-in device as the server reports it; `ref` stands for the login, never its session id. */
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

/** Used by the device list and the new-device notice. Null when the server does not answer. */
export async function fetchLoginDevices(): Promise<LoginDeviceList | null> {
  const response = await api.auth.devices();
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as Partial<LoginDeviceList> | null;
  if (!data || !Array.isArray(data.logins)) return null;
  return { logins: data.logins, max: typeof data.max === 'number' ? data.max : 3 };
}

/** Signs another device out. Resolves false when it was already gone or the server refused. */
export async function endLoginDevice(ref: string) {
  const response = await api.auth.endDevice(ref);
  return response.ok;
}

/**
 * The signed-in devices, refreshed every `intervalMs`. `list` stays null
 * while the server does not answer.
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

import { useEffect, useRef, useState } from 'react';
import { MonitorSmartphone, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { endLoginDevice, loginDetails, useLoginDevices, type LoginDevice } from '@/modules/settings/hooks/useLoginDevices';
import { Button } from '@/shared/ui';

/**
 * Mounted by App while signed in: tells this device when another one signs in
 * to this ClaudeWeb, with a way to sign it out.
 */
export default function LoginDeviceNotice() {
  const { t } = useTranslation('settings');
  const { list, refresh } = useLoginDevices(30000);
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<LoginDevice[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    if (!list) return;
    const live = new Set(list.logins.map((login) => login.ref));
    const seen = known.current;
    known.current = live;
    // The first answer is what was already signed in; only later arrivals are news.
    const added = seen ? list.logins.filter((login) => !login.current && !seen.has(login.ref)) : [];
    setFresh((current) => {
      const kept = current.filter((login) => live.has(login.ref));
      return added.length || kept.length !== current.length ? [...kept, ...added] : current;
    });
  }, [list]);

  if (!fresh.length) return null;
  const dismiss = (ref: string) => setFresh((current) => current.filter((login) => login.ref !== ref));
  const kick = async (login: LoginDevice) => {
    dismiss(login.ref);
    setConfirming(null);
    await endLoginDevice(login.ref).catch(() => false);
    await refresh();
  };

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-[1000] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2">
      {fresh.map((login) => (
        <div key={login.ref} role="status" className="pointer-events-auto rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
          <div className="flex items-start gap-2">
            <MonitorSmartphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t('about.devices.notice.title', { device: login.device || t('about.devices.unknown') })}</div>
              <div className="truncate text-xs text-muted-foreground">{loginDetails(login, t)}</div>
            </div>
            <button type="button" onClick={() => dismiss(login.ref)} aria-label={t('about.devices.notice.dismiss')} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          {confirming === login.ref ? (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-muted-foreground">{t(login.via === 'cmcp' ? 'about.devices.confirmCmcp' : 'about.devices.confirm')}</p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>{t('about.devices.cancel')}</Button>
                <Button size="sm" variant="destructive" onClick={() => void kick(login)}>{t('about.devices.kick')}</Button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => dismiss(login.ref)}>{t('about.devices.notice.dismiss')}</Button>
              <Button size="sm" variant="destructive" onClick={() => setConfirming(login.ref)}>{t('about.devices.kick')}</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

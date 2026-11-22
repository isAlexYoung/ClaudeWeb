import { useState } from 'react';
import { AlertTriangle, MonitorSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { endLoginDevice, loginDetails, useLoginDevices, type LoginDevice } from '@/modules/settings/hooks/useLoginDevices';
import { Button } from '@/shared/ui';

/**
 * Rendered by the Account tab: every device signed in to this ClaudeWeb (up to
 * three), with a sign-out for the others.
 */
export default function LoginDevicesSection() {
  const { t } = useTranslation('settings');
  const { list, refresh } = useLoginDevices(15000);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState(false);

  if (!list) return null;
  const end = async (login: LoginDevice) => {
    setConfirming(null);
    setError(!(await endLoginDevice(login.ref).catch(() => false)));
    await refresh();
  };

  return (
    <SettingsSection title={t('about.devices.title', { count: list.logins.length, max: list.max })}
      description={t('about.devices.description', { max: list.max })}>
      <SettingsCard>
        {list.logins.map((login) => (
          <div key={login.ref} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <MonitorSmartphone className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
                <span className="truncate">{login.device || t('about.devices.unknown')}</span>
                {login.main && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">{t('about.devices.main')}</span>}
                {login.current && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('about.devices.current')}</span>}
              </div>
              <div className="truncate text-xs text-muted-foreground">{loginDetails(login, t)}</div>
            </div>
            {!login.current && (confirming === login.ref ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                <span className="text-xs text-muted-foreground">{t(login.via === 'cmcp' ? 'about.devices.confirmCmcp' : 'about.devices.confirm')}</span>
                <Button size="sm" variant="destructive" onClick={() => void end(login)}>{t('about.devices.kick')}</Button>
                <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>{t('about.devices.cancel')}</Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirming(login.ref)}>{t('about.devices.kick')}</Button>
            ))}
          </div>
        ))}
        {error && (
          <div className="flex items-start gap-2 px-4 py-3 text-sm text-red-600 dark:text-red-400" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{t('about.devices.kickFailed')}</span>
          </div>
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

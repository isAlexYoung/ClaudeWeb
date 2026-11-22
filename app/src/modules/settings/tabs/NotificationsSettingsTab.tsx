import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { Button } from '@/shared/ui';
import { playChatCompletionSound } from '@/shared/utils';
import type { NotificationPreferencesState } from '@/shared/types';

type NotificationsSettingsTabProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  pushError?: string | null;
  onEnablePush: () => void;
  onDisablePush: () => void;
  isDesktop?: boolean;
  desktopNotifications?: {
    enabled: boolean;
    supported: boolean;
    connectedCount?: number;
    targetCount?: number;
    lastError?: string | null;
  } | null;
  onEnableDesktopNotifications?: () => void;
  onDisableDesktopNotifications?: () => void;
};

/** Rendered by Settings for the "notifications" tab, covering notification channels and events. */
export default function NotificationsSettingsTab({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  pushError,
  onEnablePush,
  onDisablePush,
  isDesktop = false,
  desktopNotifications = null,
  onEnableDesktopNotifications,
  onDisableDesktopNotifications,
}: NotificationsSettingsTabProps) {
  const { t } = useTranslation('settings');

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';

  return (
    <div className="space-y-6">
      <div><h3 className="text-lg font-medium">{t('notifications.title')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('notifications.description')}</p></div>
      <SettingsCard>
        <SettingsRow
          label={t(isDesktop ? 'notifications.desktop.enable' : 'notifications.webPush.enable')}
          description={t(isDesktop ? 'notifications.desktop.title' : 'notifications.webPush.title')}
        >
          {isDesktop ? <SettingsToggle
            checked={desktopNotifications?.enabled ?? false} disabled={desktopNotifications?.supported === false}
            ariaLabel={t('notifications.desktop.enable')}
            onChange={enabled => { if (enabled) onEnableDesktopNotifications?.(); else onDisableDesktopNotifications?.(); }}
          /> : <div className="flex items-center gap-2">
            {isPushLoading && <span className="text-xs text-muted-foreground" role="status">{t('notifications.webPush.loading')}</span>}
            <SettingsToggle checked={isPushSubscribed} disabled={isPushLoading || !pushSupported || pushDenied} ariaLabel={t('notifications.webPush.enable')}
              onChange={enabled => { if (enabled) onEnablePush(); else onDisablePush(); }} />
          </div>}
        </SettingsRow>
        {isDesktop ? <>
          {desktopNotifications?.supported === false && <p className="px-4 pb-4 text-xs text-muted-foreground">{t('notifications.desktop.unsupported')}</p>}
          {desktopNotifications?.lastError && <p role="alert" className="px-4 pb-4 text-xs text-destructive">{desktopNotifications.lastError}</p>}
        </> : <>
          {pushError && <p role="alert" className="px-4 pb-4 text-xs text-destructive">{pushError}</p>}
          {!pushSupported ? <p className="px-4 pb-4 text-xs text-muted-foreground">{t('notifications.webPush.unsupported')}</p>
            : pushDenied ? <p className="px-4 pb-4 text-xs text-muted-foreground">{t('notifications.webPush.denied')}</p> : null}
        </>}
      </SettingsCard>
      <SettingsSection title={t('notifications.sound.title')}>
        <SettingsCard>
          <SettingsRow label={t('notifications.sound.title')} description={t('notifications.sound.description')}>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => { void playChatCompletionSound({ force: true }); }}>{t('notifications.sound.test')}</Button>
              <SettingsToggle checked={notificationPreferences.channels.sound} ariaLabel={t('notifications.sound.title')}
                onChange={sound => onNotificationPreferencesChange({ ...notificationPreferences, channels: { ...notificationPreferences.channels, sound } })} />
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t('notifications.events.title')}>
        <SettingsCard>
          {(['actionRequired', 'stop', 'error'] as const).map(event => <SettingsRow key={event} label={t(`notifications.events.${event}`)}>
            <SettingsToggle checked={notificationPreferences.events[event]} ariaLabel={t(`notifications.events.${event}`)}
              onChange={value => onNotificationPreferencesChange({ ...notificationPreferences, events: { ...notificationPreferences.events, [event]: value } })} />
          </SettingsRow>)}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

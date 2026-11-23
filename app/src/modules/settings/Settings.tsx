import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { ProviderLoginModal } from '@/modules/provider-auth';
import { useOptionalPlugins } from '@/modules/plugins';
import { Button } from '@/shared/ui';
import { api } from '@/shared/api';
import SettingsSidebar from '@/modules/settings/SettingsSidebar';
import AgentsSettingsTab from '@/modules/settings/tabs/agents-settings/AgentsSettingsTab';
import AppearanceSettingsTab from '@/modules/settings/tabs/AppearanceSettingsTab';
import UsageSettingsTab from '@/modules/settings/tabs/UsageSettingsTab';
import YourClaudeSettingsTab from '@/modules/settings/tabs/YourClaudeSettingsTab';
import NotificationsSettingsTab from '@/modules/settings/tabs/NotificationsSettingsTab';
import TasksSettingsTab from '@/modules/settings/tabs/tasks-settings/TasksSettingsTab';
import PluginsSettingsTab from '@/modules/settings/tabs/PluginsSettingsTab';
import '@/modules/settings/settings-layout.css';
import AboutTab from '@/modules/settings/tabs/AboutTab';
import BackupSettingsTab from '@/modules/settings/tabs/backup-settings/BackupSettingsTab';
import { useSettingsController } from '@/modules/settings/hooks/useSettingsController';
import { useWebPush } from '@/modules/settings/hooks/useWebPush';
import type { AgentSettingsProject } from '@/shared/types';

type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: AgentSettingsProject[];
  initialTab?: string;
  /** Called after a session or project leaves the archive (restored or deleted) so the sidebar can refresh. */
  onArchiveChanged?: () => void;
};

type DesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

/** Exported as the settings module's public entry point and rendered by the sidebar module as its settings dialog. */
function Settings({ isOpen, onClose, projects = [], initialTab = 'agents', onArchiveChanged }: SettingsProps) {
  const { t } = useTranslation('settings');
  const { isPresent, presenceProps } = useSurfacePresence(isOpen);
  const pluginsCtx = useOptionalPlugins();
  const isPluginDrawerOpen = useMemo(() => {
    if (!pluginsCtx?.openPanelPlugin) return false;
    const panelPlugin = pluginsCtx.plugins.find((p) => p.name === pluginsCtx.openPanelPlugin);
    return Boolean(panelPlugin && panelPlugin.panel?.mode !== 'modal');
  }, [pluginsCtx?.openPanelPlugin, pluginsCtx?.plugins]);
  const desktopNotificationsBridge = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : ((window as any).claudewebDesktopNotifications || null)
  ), []);
  const [desktopNotificationsState, setDesktopNotificationsState] = useState<DesktopNotificationsState | null>(null);
  const {
    activeTab,
    setActiveTab,
    projectSortOrder,
    setProjectSortOrder,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    notificationPreferences,
    setNotificationPreferences,
    providerAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    handleLoginComplete,
  } = useSettingsController({
    isOpen,
    initialTab
  });

  const {
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    isLoading: isPushLoading,
    error: pushError,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = useWebPush();

  const synchronizePushPreference = async () => {
    // The channel belongs to all subscribed browsers; turning this one off must not disable the others.
    try {
      const response = await api.settings.notificationPreferences();
      if (!response.ok) return;
      const data = await response.json() as { preferences?: { channels?: { webPush?: boolean } } };
      const webPush = data.preferences?.channels?.webPush;
      if (typeof webPush === 'boolean') {
        setNotificationPreferences(previous => ({ ...previous, channels: { ...previous.channels, webPush } }));
      }
    } catch {
      // The subscription operation already persisted on the server; a later settings load rehydrates it.
    }
  };
  const handleEnablePush = async () => {
    if (await pushSubscribe()) await synchronizePushPreference();
  };
  const handleDisablePush = async () => {
    if (await pushUnsubscribe()) await synchronizePushPreference();
  };

  useEffect(() => {
    if (!desktopNotificationsBridge) return undefined;
    let mounted = true;
    desktopNotificationsBridge.getState().then((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    }).catch(() => {});
    const unsubscribe = desktopNotificationsBridge.onStateUpdated?.((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [desktopNotificationsBridge]);

  const handleEnableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: true });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: true },
    });
  };

  const handleDisableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: false });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: false },
    });
  };

  // Escape closes Settings, matching the other modals in the app. Layers that open
  // on top of it — nested modals, dropdown menus — mark themselves with
  // `data-escape-layer` and get the Escape first, so dismissing a menu never also
  // pulls Settings out from under the user.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[data-escape-layer]')) {
        return;
      }
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // A click only counts as "outside" when it both started and ended on the backdrop:
  // releasing on the backdrop after selecting text inside the panel must not close it.
  const backdropMouseDownRef = useRef(false);

  const handleBackdropMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = event.target === event.currentTarget;
  }, []);

  const handleBackdropClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const startedOnBackdrop = backdropMouseDownRef.current;
      backdropMouseDownRef.current = false;
      if (startedOnBackdrop && event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isPresent) {
    return null;
  }

  const isAuthenticated = Boolean(loginProvider && providerAuthStatus[loginProvider].authenticated);

  return (
    <div
      className={`motion-modal modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-sm md:p-4 ${
        isPluginDrawerOpen ? 'pointer-events-none opacity-0' : ''
      }`}
      {...presenceProps}
      aria-hidden={isPluginDrawerOpen ? true : presenceProps['aria-hidden']}
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      {/* Marked as a modal dialog so layers underneath, like the code editor, leave its Escape alone. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        className="motion-modal-panel flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl"
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3 md:px-5">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-10 w-10 touch-manipulation p-0 text-muted-foreground hover:text-foreground active:bg-accent/50"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <SettingsSidebar activeTab={activeTab} onChange={setActiveTab} />

          {/* Content */}
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div key={activeTab} className="settings-content-enter settings-surface min-w-0 space-y-6 overflow-x-hidden p-4 pb-safe-area-inset-bottom md:p-6">
              {activeTab === 'appearance' && (
                <AppearanceSettingsTab
                  projectSortOrder={projectSortOrder}
                  onProjectSortOrderChange={setProjectSortOrder}
                  codeEditorSettings={codeEditorSettings}
                  onCodeEditorWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
                  onCodeEditorShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
                  onCodeEditorLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
                  onCodeEditorFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
                />
              )}

              {activeTab === 'usage' && <UsageSettingsTab />}

              {activeTab === 'claude' && <YourClaudeSettingsTab />}


              {activeTab === 'agents' && (
                <AgentsSettingsTab
                  providerAuthStatus={providerAuthStatus}
                  onProviderLogin={openLoginForProvider}
                />
              )}

              {activeTab === 'tasks' && <TasksSettingsTab onArchiveChanged={onArchiveChanged} claudePermissions={claudePermissions} onClaudePermissionsChange={setClaudePermissions} />}

              {activeTab === 'notifications' && (
                <NotificationsSettingsTab
                  notificationPreferences={notificationPreferences}
                  onNotificationPreferencesChange={setNotificationPreferences}
                  pushPermission={pushPermission}
                  isPushSubscribed={isPushSubscribed}
                  isPushLoading={isPushLoading}
                  pushError={pushError}
                  onEnablePush={handleEnablePush}
                  onDisablePush={handleDisablePush}
                  isDesktop={Boolean(desktopNotificationsBridge)}
                  desktopNotifications={desktopNotificationsState}
                  onEnableDesktopNotifications={handleEnableDesktopNotifications}
                  onDisableDesktopNotifications={handleDisableDesktopNotifications}
                />
              )}


              {activeTab === 'plugins' && <PluginsSettingsTab projects={projects} />}

              {activeTab === 'backup' && <BackupSettingsTab />}

              {activeTab === 'about' && <AboutTab />}
            </div>
          </main>
        </div>
      </div>

      <ProviderLoginModal
        key={loginProvider || 'claude'}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider || 'claude'}
        onComplete={handleLoginComplete}
        isAuthenticated={isAuthenticated}
      />

    </div>
  );
}

export default Settings;

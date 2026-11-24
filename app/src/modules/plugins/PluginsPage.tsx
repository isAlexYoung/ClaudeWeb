import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe } from 'lucide-react';

import ExtensionsSettingsPage from '@/modules/plugins/ExtensionsSettingsPage';
import type { McpProject } from '@/shared/types';

/** Used by project-workspace for the sidebar's full-size manager, sharing Settings' actions and state. */
export default function PluginsPage({ currentProjects, menuButton, onOpenBrowser, browserMinimized = false }: { currentProjects: McpProject[]; menuButton?: ReactNode; onOpenBrowser?: () => void; browserMinimized?: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <div className="workspace-main flex h-full min-w-0 flex-1 flex-col" data-testid="plugins-page">
      <header className="flex shrink-0 items-center gap-3 px-5 py-5 sm:px-8">
        {menuButton}
        <h1 className="mr-auto text-2xl font-medium">{t('mainTabs.plugins')}</h1>
        {onOpenBrowser && <button type="button" className="workspace-icon-button workspace-tool-button" aria-label={t('extensions.openWorkspaceBrowser')} title={t('extensions.openWorkspaceBrowser')} onClick={onOpenBrowser}>
          <Globe size={19} />
          {browserMinimized && <span className="workspace-tool-running-dot" data-testid="browser-running-dot" aria-hidden="true" />}
        </button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 sm:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <ExtensionsSettingsPage currentProjects={currentProjects} showRecommendations onOpenBrowser={onOpenBrowser} />
        </div>
      </div>
    </div>
  );
}

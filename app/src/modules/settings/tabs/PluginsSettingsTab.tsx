import { useTranslation } from 'react-i18next';

import { PluginSettingsTab, usePlugins } from '@/modules/plugins';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import type { AgentSettingsProject } from '@/shared/types';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { Button } from '@/shared/ui';

/** Used by Settings to keep custom plugins, MCP servers and skills in one extension page. */
export default function PluginsSettingsTab({ projects }: { projects: AgentSettingsProject[] }) {
  const { t } = useTranslation('settings');
  const { chatMcpEnabled } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { refreshPlugins } = usePlugins();
  const refreshActions = useRef<Record<string, (() => Promise<void>) | null>>({});
  // Blocks duplicate refreshes while the three extension lists reload together.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const registerMcpRefresh = useCallback((refresh: (() => Promise<void>) | null) => { refreshActions.current.mcp = refresh; }, []);
  const registerSkillsRefresh = useCallback((refresh: (() => Promise<void>) | null) => { refreshActions.current.skills = refresh; }, []);
  const refreshAll = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.allSettled([refreshPlugins(), ...Object.values(refreshActions.current).filter(action => action !== null).map(action => action())]);
    } finally {
      setIsRefreshing(false);
    }
  };
  const currentProjects = projects.map(project => ({
    projectId: project.name, displayName: project.displayName, fullPath: project.fullPath, path: project.path,
  }));
  return (
    <div className="relative space-y-6">
      <Button className="absolute right-0 top-0" variant="outline" size="sm" disabled={isRefreshing} aria-busy={isRefreshing} onClick={() => void refreshAll()}>
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        {t('skillsPage.refresh')}
      </Button>
      <section aria-label={t('mainTabs.plugins')}><PluginSettingsTab /></section>
      <section aria-label={t('tabs.mcpServers')}>
        <McpServers selectedProvider="claude" currentProjects={currentProjects} onRefreshReady={registerMcpRefresh}>
          <SettingsRow label={t('chatMcp.label')} description={t('chatMcp.description')}>
            <SettingsToggle checked={chatMcpEnabled} onChange={value => setPreference('chatMcpEnabled', value)} ariaLabel={t('chatMcp.label')} />
          </SettingsRow>
        </McpServers>
      </section>
      <section aria-label={t('tabs.skills')}>
        <ProviderSkills selectedProvider="claude" currentProjects={currentProjects} onRefreshReady={registerSkillsRefresh} />
      </section>
    </div>
  );
}
import { useCallback, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { useTranslation } from 'react-i18next';

import { PluginSettingsTab } from '@/modules/plugins';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import type { AgentSettingsProject } from '@/shared/types';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';

/** Used by Settings to keep custom plugins, MCP servers and skills in one extension page. */
export default function PluginsSettingsTab({ projects }: { projects: AgentSettingsProject[] }) {
  const { t } = useTranslation('settings');
  const { chatMcpEnabled } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const currentProjects = projects.map(project => ({
    projectId: project.name, displayName: project.displayName, fullPath: project.fullPath, path: project.path,
  }));
  return (
    <div className="space-y-8">
      <section aria-label={t('mainTabs.plugins')}><PluginSettingsTab /></section>
      <section className="border-t border-border/50 pt-6" aria-label={t('tabs.mcpServers')}>
        <McpServers selectedProvider="claude" currentProjects={currentProjects}>
          <SettingsRow label={t('chatMcp.label')} description={t('chatMcp.description')}>
            <SettingsToggle checked={chatMcpEnabled} onChange={value => setPreference('chatMcpEnabled', value)} ariaLabel={t('chatMcp.label')} />
          </SettingsRow>
        </McpServers>
      </section>
      <section className="border-t border-border/50 pt-6" aria-label={t('tabs.skills')}>
        <ProviderSkills selectedProvider="claude" currentProjects={currentProjects} />
      </section>
    </div>
  );
}

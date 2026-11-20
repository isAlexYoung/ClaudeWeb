import { useTranslation } from 'react-i18next';

import type { AgentProvider, AgentSettingsProject, ClaudePermissionsState, ProviderAuthStatus } from '@/shared/types';
import { McpServers } from '@/modules/mcp';
import { ProviderSkills } from '@/modules/skills';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import ProfileSection from '@/modules/settings/tabs/agents-settings/ProfileSection';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import PermissionsContent from '@/modules/settings/tabs/agents-settings/sections/content/PermissionsContent';

type AgentsSettingsTabProps = {
  providerAuthStatus: Record<AgentProvider, ProviderAuthStatus>;
  onProviderLogin: (provider: AgentProvider) => void;
  claudePermissions: ClaudePermissionsState;
  onClaudePermissionsChange: (value: ClaudePermissionsState) => void;
  projects: AgentSettingsProject[];
};

/** Used by Settings for General: one continuous page sharing the dialog's content scroller. */
export default function AgentsSettingsTab({ providerAuthStatus, onProviderLogin, claudePermissions, onClaudePermissionsChange, projects }: AgentsSettingsTabProps) {
  const { t } = useTranslation('settings');
  const { chatMcpEnabled } = useUiPreferences();
  const setPreference = useSetUiPreference();
  const currentProjects = projects.map(project => ({
    projectId: project.name, displayName: project.displayName, fullPath: project.fullPath, path: project.path,
  }));

  return (
    <div className="min-w-0 space-y-8" data-testid="general-settings-page">
      <SettingsSection title={t('tabs.account')}>
        <ProfileSection>
          <AccountContent agent="claude" authStatus={providerAuthStatus.claude} onLogin={() => onProviderLogin('claude')} />
        </ProfileSection>
      </SettingsSection>
      <PermissionsContent
        agent="claude"
        skipPermissions={claudePermissions.skipPermissions}
        onSkipPermissionsChange={value => onClaudePermissionsChange({ ...claudePermissions, skipPermissions: value })}
        allowedTools={claudePermissions.allowedTools}
        onAllowedToolsChange={value => onClaudePermissionsChange({ ...claudePermissions, allowedTools: value })}
        disallowedTools={claudePermissions.disallowedTools}
        onDisallowedToolsChange={value => onClaudePermissionsChange({ ...claudePermissions, disallowedTools: value })}
      />
      <section className="space-y-3" aria-label={t('tabs.mcpServers')}>
        <McpServers selectedProvider="claude" currentProjects={currentProjects}>
          <SettingsRow label={t('chatMcp.label')} description={t('chatMcp.description')}>
            <SettingsToggle checked={chatMcpEnabled} onChange={value => setPreference('chatMcpEnabled', value)} ariaLabel={t('chatMcp.label')} />
          </SettingsRow>
        </McpServers>
      </section>
      <section aria-label={t('tabs.skills')}>
        <ProviderSkills selectedProvider="claude" currentProjects={currentProjects} />
      </section>
    </div>
  );
}

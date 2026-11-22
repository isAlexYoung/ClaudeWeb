import { useTranslation } from 'react-i18next';

import type { AgentProvider, ProviderAuthStatus } from '@/shared/types';
import SettingsSection from '@/modules/settings/SettingsSection';
import ProfileSection from '@/modules/settings/tabs/agents-settings/ProfileSection';
import AccountContent from '@/modules/settings/tabs/agents-settings/sections/content/AccountContent';
import ClaudeNameField from '@/modules/settings/tabs/agents-settings/ClaudeNameField';
import LoginDevicesSection from '@/modules/settings/tabs/LoginDevicesSection';

type AgentsSettingsTabProps = {
  providerAuthStatus: Record<AgentProvider, ProviderAuthStatus>;
  onProviderLogin: (provider: AgentProvider) => void;
};

/** Used by Settings for Account: the interface profile, Claude name, sign-in and devices. */
export default function AgentsSettingsTab({ providerAuthStatus, onProviderLogin }: AgentsSettingsTabProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="min-w-0 space-y-6" data-testid="account-settings-page">
      <SettingsSection title={t('tabs.account')}>
        <ProfileSection>
          <ClaudeNameField />
          <AccountContent agent="claude" authStatus={providerAuthStatus.claude} onLogin={() => onProviderLogin('claude')} />
        </ProfileSection>
      </SettingsSection>
      <LoginDevicesSection />
    </div>
  );
}

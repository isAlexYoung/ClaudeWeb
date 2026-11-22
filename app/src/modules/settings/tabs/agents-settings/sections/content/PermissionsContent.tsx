import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';

type PermissionsContentProps = {
  skipPermissions: boolean;
  onSkipPermissionsChange: (value: boolean) => void;
};

/** Used by Tasks & sessions and the legacy category panel to change the permission mode. */
export default function PermissionsContent({ skipPermissions, onSkipPermissionsChange }: PermissionsContentProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-6">
      <SettingsSection title={t('tabs.permissions')}>
        <SettingsCard>
          <SettingsRow label={t('permissions.skipPermissions.label')} description={t('permissions.skipPermissions.claudeDescription')}>
            <SettingsToggle checked={skipPermissions} onChange={onSkipPermissionsChange} ariaLabel={t('permissions.skipPermissions.label')} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

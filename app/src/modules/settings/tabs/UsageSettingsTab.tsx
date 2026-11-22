import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { QuotaDetails } from '@/shared/ui';

/** Rendered by Settings for the "usage" tab: the subscription's quota windows, opened from the composer's quota popover and the account menu. */
export default function UsageSettingsTab() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6">
      <SettingsSection title={t('mainTabs.usage')}>
        <SettingsCard className="p-4">
          <QuotaDetails />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

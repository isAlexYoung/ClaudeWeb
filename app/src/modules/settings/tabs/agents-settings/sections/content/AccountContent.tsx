import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import SettingsRow from '@/modules/settings/SettingsRow';
import type { AgentProvider, ProviderAuthStatus, ProviderAuthSubscriptionOverride } from '@/shared/types';

type AccountContentProps = {
  agent: AgentProvider;
  authStatus: ProviderAuthStatus;
  onLogin: () => void;
};
type SubscriptionOverrideNoticeProps = {
  override: ProviderAuthSubscriptionOverride;
};

// Issue #568: Claude Code prefers ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN over
// the `claude /login` subscription and says nothing about it, so a subscriber
// who also has a key in the server env is billed pay-as-you-go without knowing.
// The server only reports the override while a usable login is really being
// bypassed, so this stays out of the way for key-only and login-only setups.
function SubscriptionOverrideNotice({ override }: SubscriptionOverrideNoticeProps) {
  const { t } = useTranslation('settings');
  const source = t(`agents.subscriptionOverride.source.${override.source}`);
  const description = override.subscriptionEmail
    ? t('agents.subscriptionOverride.descriptionWithEmail', {
      variable: override.variable,
      source,
      email: override.subscriptionEmail,
    })
    : t('agents.subscriptionOverride.description', { variable: override.variable, source });

  return (
    <div
      role="alert"
      data-testid="provider-auth-subscription-override"
      className="px-4 py-4 text-xs text-muted-foreground"
    >
      <div className="flex items-start gap-2">
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          <div className="font-medium">{t('agents.subscriptionOverride.title')}</div>
          <p>{description}</p>
          <p>{t(`agents.subscriptionOverride.fix.${override.source}`, { variable: override.variable })}</p>
        </div>
      </div>
    </div>
  );
}


/** Used by General's profile card (and the legacy category panel) for live Claude sign-in rows. */
export default function AccountContent({ agent, authStatus, onLogin }: AccountContentProps) {
  const { t } = useTranslation('settings');
  const status = authStatus.loading ? t('agents.authStatus.checking')
    : authStatus.authenticated ? t('agents.authStatus.connected') : t('agents.authStatus.disconnected');
  const description = authStatus.loading ? t('agents.authStatus.checkingAuth')
    : authStatus.authenticated ? t('agents.authStatus.loggedInAs', { email: authStatus.email || t('agents.authStatus.authenticatedUser') })
      : t('agents.authStatus.notConnected');
  // Being signed out is already explained by the status row, not a raw CLI diagnostic.
  const showError = authStatus.error && !/not authenticated|not logged in|claude.*\/login|configure ANTHROPIC_API_KEY/i.test(authStatus.error);
  return (
    <>
      <SettingsRow label={t('agents.connectionStatus')} description={description}>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <i className={`h-1.5 w-1.5 rounded-full ${authStatus.authenticated ? 'bg-primary' : 'bg-muted-foreground'}`} />{status}
        </span>
      </SettingsRow>
      {!authStatus.loading && authStatus.subscriptionOverride && <SubscriptionOverrideNotice override={authStatus.subscriptionOverride} />}
      {authStatus.method !== 'api_key' && (
        <SettingsRow
          label={authStatus.authenticated ? t('agents.login.reAuthenticate') : t('agents.login.title')}
          description={authStatus.authenticated ? t('agents.login.reAuthDescription') : t('agents.login.description', { agent: agent === 'claude' ? 'Claude' : agent })}
        >
          <Button onClick={onLogin} size="sm">{authStatus.authenticated ? t('agents.login.reLoginButton') : t('agents.login.button')}</Button>
        </SettingsRow>
      )}
      {showError && <p role="alert" className="px-4 py-3 text-xs text-destructive">{t('agents.error', { error: authStatus.error })}</p>}
    </>
  );
}

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiErrorMessage } from '@/shared/api';
import { ProviderLoginModal, useProviderAuthStatus } from '@/modules/provider-auth';
import AgentConnectionsStep from '@/modules/onboarding/AgentConnectionsStep';

type OnboardingProps = {
  onComplete?: () => void | Promise<void>;
};

/** Used by ProtectedRoute to offer Claude login; Git identity is optional in Settings. */
export default function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation('auth');
  // Completion errors must remain visible and retryable instead of trapping the user in a spinner.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The failure text is shared by automatic completion and the explicit skip action.
  const [errorMessage, setErrorMessage] = useState('');
  // Keep the login terminal open until login succeeds or the user dismisses it.
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const completionStartedRef = useRef(false);
  const { providerAuthStatus, checkProviderAuthStatus } = useProviderAuthStatus();
  const claudeStatus = providerAuthStatus.claude;

  useEffect(() => { void checkProviderAuthStatus('claude'); }, [checkProviderAuthStatus]);

  const handleFinish = useCallback(async () => {
    if (completionStartedRef.current) return;
    completionStartedRef.current = true;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const response = await api.user.completeOnboarding();
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        throw new Error(readApiErrorMessage(payload) ?? t('onboarding.errorCompleteOnboarding'));
      }
      await onComplete?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('onboarding.errorCompleteOnboarding'));
      completionStartedRef.current = false;
    } finally {
      setIsSubmitting(false);
    }
  }, [onComplete, t]);

  useEffect(() => {
    if (!claudeStatus.loading && claudeStatus.authenticated && !errorMessage) {
      void handleFinish();
    }
  }, [claudeStatus.authenticated, claudeStatus.loading, errorMessage, handleFinish]);

  // Do not flash the login card for a VPS whose Claude Code session is already authenticated.
  if (claudeStatus.loading || (claudeStatus.authenticated && !errorMessage)) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 bg-background text-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t('onboarding.checking')}
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl">
          <AgentConnectionsStep
            providerStatuses={providerAuthStatus}
            onOpenProviderLogin={() => setIsLoginOpen(true)}
          />
          {errorMessage && <p role="alert" className="mt-4 text-sm text-destructive">{errorMessage}</p>}
          <div className="mt-6 flex justify-end border-t border-border pt-4">
            <button type="button" onClick={() => { void handleFinish(); }} disabled={isSubmitting}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {claudeStatus.authenticated ? t('onboarding.completeSetup') : t('onboarding.skipLogin')}
            </button>
          </div>
        </div>
      </div>
      <ProviderLoginModal isOpen={isLoginOpen} provider="claude"
        onClose={() => { setIsLoginOpen(false); void checkProviderAuthStatus('claude'); }}
        onComplete={(exitCode) => {
          if (exitCode === 0) {
            setIsLoginOpen(false);
            void checkProviderAuthStatus('claude');
          }
        }}
      />
    </>
  );
}

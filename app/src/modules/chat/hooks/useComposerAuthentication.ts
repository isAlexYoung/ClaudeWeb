import { useEffect } from 'react';

import { useProviderAuthStatus } from '@/modules/provider-auth';

/** Rechecks CLI login for ChatComposer after terminal/browser login or logout, without polling hidden tabs. */
export function useComposerAuthentication(): boolean {
  const { providerAuthStatus, checkProviderAuthStatus } = useProviderAuthStatus();

  useEffect(() => {
    let checking = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || checking) return;
      checking = true;
      try { await checkProviderAuthStatus('claude'); } finally { checking = false; }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [checkProviderAuthStatus]);

  return providerAuthStatus.claude.authenticated;
}

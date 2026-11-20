import { useEffect } from 'react';

import { api } from '@/shared/api';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { startLoginActivity } from '@/modules/auth/utils/startLoginActivity';

/** Mounted within the workspace's activity provider; keeps active model turns and
 * background tasks usable while manual browser logins otherwise expire on idle.
 */
export function useLoginActivity() {
  const busy = useBusySessionIdSet().size > 0;
  useEffect(() => {
    if (import.meta.env.VITE_WEBDESKTOP !== 'true') return;
    return startLoginActivity({
      isBusy: () => busy,
      renew: api.auth.webdesktopActivity,
    });
  }, [busy]);
}

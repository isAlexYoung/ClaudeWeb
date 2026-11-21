import { useEffect } from 'react';

import { api } from '@/shared/api';
import { useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import { startLoginActivity } from '@/modules/auth/utils/startLoginActivity';

/**
 * Mounted within the workspace's activity provider: real input and working
 * chats keep this browser login alive; a login left alone for an hour ends.
 */
export function useLoginActivity() {
  const busy = useBusySessionIdSet().size > 0;
  useEffect(() => startLoginActivity({ isBusy: () => busy, renew: api.auth.activity }), [busy]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiErrorMessage } from '@/shared/api';
import { registerNotificationWorker, supportsWebPush } from '@/shared/utils';

type WebPushState = {
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  error: string | null;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const rawData = window.atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(rawData, character => character.charCodeAt(0));
}

async function assertSuccessful(response: Response): Promise<void> {
  if (response.ok) return;
  const payload: unknown = await response.json().catch(() => null);
  throw new Error(readApiErrorMessage(payload) ?? ('HTTP ' + response.status));
}

/** Used by Settings to manage this browser's push endpoint and report actual subscription failures. */
export function useWebPush(): WebPushState {
  const { t } = useTranslation('settings');
  // Permission can change after the browser prompt; it controls the disabled state and explanation.
  const [permission, setPermission] = useState<WebPushState['permission']>(() => supportsWebPush() ? Notification.permission : 'unsupported');
  // Reflect a successful browser and server subscription, never an optimistic toggle.
  const [isSubscribed, setIsSubscribed] = useState(false);
  // Prevent overlapping subscribe/unsubscribe requests.
  const [isLoading, setIsLoading] = useState(false);
  // Expose failures so a user can retry without a permanently spinning switch.
  const [error, setError] = useState<string | null>(null);
  const mutationRef = useRef(0);

  useEffect(() => {
    if (!supportsWebPush()) return;
    let active = true;
    const mutation = mutationRef.current;
    void registerNotificationWorker()
      .then(registration => registration.pushManager.getSubscription())
      .then(subscription => { if (active && mutation === mutationRef.current) setIsSubscribed(subscription !== null); })
      .catch(() => { /* The explicit enable action reports registration errors and permits retry. */ });
    return () => { active = false; };
  }, []);

  const subscribe = useCallback(async () => {
    if (permission === 'unsupported') return false;
    mutationRef.current += 1;
    setIsLoading(true);
    setError(null);
    let createdSubscription: PushSubscription | null = null;
    try {
      // Request permission directly in the click gesture, before awaiting worker activation.
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== 'granted') return false;
      const keyResponse = await api.settings.push.vapidPublicKey();
      await assertSuccessful(keyResponse);
      const { publicKey } = await keyResponse.json() as { publicKey?: string };
      if (!publicKey) throw new Error(t('notifications.webPush.missingKey'));
      const registration = await registerNotificationWorker();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
        });
        createdSubscription = subscription;
      }
      const response = await api.settings.push.subscribe(subscription.toJSON());
      await assertSuccessful(response);
      setIsSubscribed(true);
      return true;
    } catch (caughtError) {
      // A server rejection must not leave a new browser endpoint looking enabled.
      await createdSubscription?.unsubscribe().catch(() => false);
      setError(t('notifications.webPush.failed', { message: caughtError instanceof Error ? caughtError.message : String(caughtError) }));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [permission, t]);

  const unsubscribe = useCallback(async () => {
    mutationRef.current += 1;
    setIsLoading(true);
    setError(null);
    try {
      const registration = await registerNotificationWorker();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await assertSuccessful(await api.settings.push.unsubscribe(subscription.endpoint));
        if (!await subscription.unsubscribe()) throw new Error(t('notifications.webPush.unsubscribeFailed'));
      }
      setIsSubscribed(false);
      return true;
    } catch (caughtError) {
      setError(t('notifications.webPush.failed', { message: caughtError instanceof Error ? caughtError.message : String(caughtError) }));
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  return { permission, isSubscribed, isLoading, error, subscribe, unsubscribe };
}

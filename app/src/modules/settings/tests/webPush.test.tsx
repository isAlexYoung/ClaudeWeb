import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import '@/modules/i18n';

const mocks = vi.hoisted(() => ({
  registration: vi.fn(), getSubscription: vi.fn(), subscribeBrowser: vi.fn(),
  subscribeServer: vi.fn(), unsubscribeServer: vi.fn(), key: vi.fn(), permission: vi.fn(),
}));
vi.mock('@/shared/utils', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  supportsWebPush: () => true,
  registerNotificationWorker: mocks.registration,
}));
vi.mock('@/shared/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  api: { settings: { push: {
    vapidPublicKey: mocks.key, subscribe: mocks.subscribeServer, unsubscribe: mocks.unsubscribeServer,
  } } },
}));
const { useWebPush } = await import('@/modules/settings/hooks/useWebPush');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: mocks.permission });
  mocks.permission.mockResolvedValue('granted');
  mocks.registration.mockResolvedValue({ pushManager: { getSubscription: mocks.getSubscription, subscribe: mocks.subscribeBrowser } });
  mocks.getSubscription.mockResolvedValue(null);
  mocks.key.mockImplementation(async () => new Response('{"publicKey":"AAAA"}'));
  mocks.subscribeServer.mockImplementation(async () => new Response('{}'));
  mocks.unsubscribeServer.mockImplementation(async () => new Response('{}'));
});

test('a successful browser subscription is saved on the server before the switch turns on', async () => {
  const unsubscribe = vi.fn();
  mocks.subscribeBrowser.mockResolvedValue({ toJSON: () => ({ endpoint: 'https://push.test', keys: {} }), unsubscribe });
  const { result } = renderHook(useWebPush);
  await act(async () => { expect(await result.current.subscribe()).toBe(true); });
  expect(result.current.isSubscribed).toBe(true);
  expect(mocks.subscribeServer).toHaveBeenCalledOnce();
});
test('a server failure rolls back a new subscription and remains retryable', async () => {
  const rollback = vi.fn(async () => true);
  mocks.subscribeBrowser.mockResolvedValue({ toJSON: () => ({}), unsubscribe: rollback });
  mocks.subscribeServer.mockImplementation(async () => new Response('{"error":"Push unavailable"}', { status: 503 }));
  const { result } = renderHook(useWebPush);
  await act(async () => { expect(await result.current.subscribe()).toBe(false); });
  expect(result.current.isSubscribed).toBe(false);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toContain('Push unavailable');
  expect(rollback).toHaveBeenCalledOnce();
});
test('denying permission does not save an enabled preference or request a push subscription', async () => {
  mocks.permission.mockResolvedValue('denied');
  const { result } = renderHook(useWebPush);
  await act(async () => { expect(await result.current.subscribe()).toBe(false); });
  expect(result.current.permission).toBe('denied');
  expect(mocks.subscribeServer).not.toHaveBeenCalled();
});
test('unsubscribe failure is reported without turning the local switch off', async () => {
  const subscription = { endpoint: 'https://push.test', unsubscribe: vi.fn() };
  mocks.getSubscription.mockResolvedValue(subscription);
  mocks.unsubscribeServer.mockImplementation(async () => new Response('{}', { status: 500 }));
  const { result } = renderHook(useWebPush);
  await waitFor(() => expect(result.current.isSubscribed).toBe(true));
  await act(async () => { expect(await result.current.unsubscribe()).toBe(false); });
  expect(result.current.isSubscribed).toBe(true);
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});
test('worker registration failures settle instead of waiting forever for serviceWorker.ready', async () => {
  mocks.registration.mockRejectedValue(new Error('worker unavailable'));
  const { result } = renderHook(useWebPush);
  await act(async () => { expect(await result.current.subscribe()).toBe(false); });
  expect(result.current.error).toContain('worker unavailable');
  expect(result.current.isLoading).toBe(false);
});

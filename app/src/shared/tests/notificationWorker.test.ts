import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { expect, test, vi } from 'vitest';

function worker(scope = 'https://example.test/claude/') {
  const listeners: Record<string, (event: any) => void> = {};
  const self = {
    registration: { scope, showNotification: vi.fn(async () => {}) },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => [] as any[]), openWindow: vi.fn() },
    skipWaiting: vi.fn(),
    addEventListener: (name: string, handler: (event: any) => void) => { listeners[name] = handler; },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL });
  return { self, listeners };
}
test('the notification worker has no fetch/cache interception and shows ClaudeWeb without an icon', async () => {
  const { self, listeners } = worker();
  expect(listeners.fetch).toBeUndefined();
  let pending: Promise<unknown> | undefined;
  listeners.push({ data: { json: () => ({ body: 'Finished', data: { sessionId: 'id-1' } }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  expect(self.registration.showNotification).toHaveBeenCalledWith('ClaudeWeb', expect.objectContaining({ body: 'Finished' }));
  const [, options] = (self.registration.showNotification.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0];
  expect(options.icon).toBeUndefined();
});
test('clicking a notification opens the session under the ClaudeWeb subpath', async () => {
  const { self, listeners } = worker();
  let pending: Promise<unknown> | undefined;
  listeners.notificationclick({ notification: { data: { sessionId: 'id/1' }, close: vi.fn() },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  expect(self.clients.openWindow).toHaveBeenCalledWith('https://example.test/claude/session/id%2F1');
});
test('clicking a notification focuses ClaudeWeb rather than a different WebDesktop app', async () => {
  const { self, listeners } = worker();
  const other = { url: 'https://example.test/desktop/', focus: vi.fn() };
  const current = { url: 'https://example.test/claude/', focus: vi.fn(), postMessage: vi.fn() };
  self.clients.matchAll.mockResolvedValue([other, current]);
  let pending: Promise<unknown> | undefined;
  listeners.notificationclick({ notification: { data: { sessionId: 'id-1', provider: 'claude' }, close: vi.fn() },
    waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  expect(other.focus).not.toHaveBeenCalled();
  expect(current.focus).toHaveBeenCalledOnce();
  expect(current.postMessage).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'id-1', urlPath: '/session/id-1' }));
});

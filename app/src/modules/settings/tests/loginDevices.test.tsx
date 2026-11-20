import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { LoginDevice } from '@/modules/settings/hooks/useLoginDevices';

const { default: LoginDevicesSection } = await import('@/modules/settings/tabs/LoginDevicesSection');
const { default: LoginDeviceNotice } = await import('@/modules/settings/LoginDeviceNotice');

const desktop: LoginDevice = { ref: 'a'.repeat(16), device: 'Windows PC', via: 'cmcp', ip: '203.0.113.9', at: Date.now() - 5 * 60000, main: true, current: false };
const phone: LoginDevice = { ref: 'b'.repeat(16), device: 'iPhone', via: 'claudeweb', ip: '198.51.100.2', at: Date.now(), main: false, current: true };
const tablet: LoginDevice = { ref: 'c'.repeat(16), device: 'iPad', via: 'desktop', ip: '', at: Date.now(), main: false, current: false };

let logins: LoginDevice[];
const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    const { ref } = JSON.parse(String(init.body)) as { ref: string };
    logins = logins.filter((login) => login.ref !== ref);
    return new Response('{"ok":true}');
  }
  return new Response(JSON.stringify({ logins, max: 3 }));
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
  logins = [desktop, phone];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('lists the signed-in devices and signs another one out only after confirming', async () => {
  render(<LoginDevicesSection />);
  expect(await screen.findByText('Signed-in devices (2/3)')).toBeTruthy();
  expect(screen.getByText('Main device')).toBeTruthy();
  expect(screen.getByText('This device')).toBeTruthy();
  expect(screen.getByText(/CMCP · 203\.0\.113\.9 · 5 min ago/)).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(screen.getByText(/CMCP connection closes too/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
  await waitFor(() => expect(screen.queryByText('Windows PC')).toBeNull());
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(post?.[0]).toMatch(/__webdesktop\/devices$/);
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ op: 'end', ref: desktop.ref });
});

test('renders nothing outside WebDesktop, where the devices endpoint does not answer', async () => {
  fetchMock.mockImplementationOnce(async () => new Response('', { status: 404 }));
  const { container } = render(<LoginDevicesSection />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(container.innerHTML).toBe('');
});

test('announces only devices that sign in later, and can sign them out', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<LoginDeviceNotice />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('status')).toBeNull();

  logins = [desktop, phone, tablet];
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(await screen.findByText('New device signed in: iPad')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(logins.map((login) => login.ref)).toEqual([desktop.ref, phone.ref]);
});

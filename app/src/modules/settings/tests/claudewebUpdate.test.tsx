import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ClaudeWebUpdateStatus } from '@/shared/types';

const mocks = vi.hoisted(() => ({ status: vi.fn(), check: vi.fn(), update: vi.fn() }));
vi.mock('@/shared/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  api: { claudewebUpdate: mocks },
}));
const { default: ClaudeWebUpdateSection } = await import('@/modules/settings/tabs/ClaudeWebUpdateSection');

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const refusal = (code: string) => json({ success: false, error: { code, message: code } }, 409);

function status(overrides: Partial<ClaudeWebUpdateStatus> = {}, state: ClaudeWebUpdateStatus['status'] = { state: 'idle' }): ClaudeWebUpdateStatus {
  return { supported: true, installed: '1.0.0', status: state, ...overrides };
}

const offer = {
  installed: '1.0.0', webdesktop: '3.0.1', latest: '1.0.1',
  newer: [{ version: '1.0.1', notes: 'Faster start', requires_webdesktop: '3.0.1', compatible: true, download_bytes: 60 * 1024 * 1024 }],
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
});

test('shows the installed version, finds a newer one and installs it only after the interruption warning', async () => {
  mocks.status.mockResolvedValue(json(status()));
  mocks.check.mockResolvedValue(json(offer));
  mocks.update.mockResolvedValue(json({ started: true, version: '1.0.1' }));
  render(<ClaudeWebUpdateSection reload={vi.fn()} />);

  expect(await screen.findByText('1.0.0')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByText('Version 1.0.1 is available (60 MB download).')).toBeTruthy();
  expect(screen.getByText('Faster start')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Update to 1.0.1' }));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(screen.getByText(/conversations that are running now are interrupted/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Update to 1.0.1 now' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('1.0.1'));
  expect(await screen.findByRole('status')).toBeTruthy();
});

test('updating to a version that is already installed shows up to date, not an error', async () => {
  mocks.status.mockResolvedValue(json(status()));
  mocks.check
    .mockResolvedValueOnce(json(offer))
    .mockResolvedValue(json({ installed: '1.0.1', webdesktop: '3.0.1', latest: '1.0.1', newer: [] }));
  mocks.update.mockResolvedValue(refusal('CLAUDEWEB_NOT_NEWER'));
  render(<ClaudeWebUpdateSection reload={vi.fn()} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Update to 1.0.1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update to 1.0.1 now' }));
  await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update to 1.0.1' })).toBeNull();
});

test('follows the updater through the restart and reloads once the new version is installed', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const reload = vi.fn();
    mocks.status
      .mockResolvedValueOnce(json(status({}, { state: 'downloading', version: '1.0.1', updated_at: Math.floor(Date.now() / 1000) })))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(json(status({ installed: '1.0.1' }, { state: 'done', version: '1.0.1' })));
    render(<ClaudeWebUpdateSection reload={reload} />);
    expect(await screen.findByText('Downloading 1.0.1…')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText('Update finished. Reloading…')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1600);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('explains refusals, a version that needs a newer WebDesktop, and hides the check outside WebDesktop', async () => {
  mocks.status.mockResolvedValue(json(status()));
  mocks.check.mockResolvedValueOnce(json({ ...offer, newer: [{ ...offer.newer[0], compatible: false, requires_webdesktop: '3.1.0' }] }));
  const { unmount } = render(<ClaudeWebUpdateSection reload={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByText(/Version 1.0.1 cannot be installed on this server/)).toBeTruthy();

  mocks.check.mockResolvedValueOnce(refusal('CLAUDEWEB_DISK_REQUIRED'));
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Not enough free disk space/);
  unmount();

  mocks.status.mockResolvedValue(json(status({ supported: false, installed: null })));
  render(<ClaudeWebUpdateSection reload={vi.fn()} />);
  expect(await screen.findByText('Unknown')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
});

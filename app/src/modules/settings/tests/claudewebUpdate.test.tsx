import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ClaudeWebUpdateStatus } from '@/shared/types';

const mocks = vi.hoisted(() => ({ status: vi.fn(), check: vi.fn(), update: vi.fn(), activity: vi.fn() }));
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
  installed: '1.0.0', latest: '1.0.1',
  newer: [{ version: '1.0.1', notes: 'Faster start', compatible: true, download_bytes: 60 * 1024 * 1024 }],
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  vi.clearAllMocks();
  mocks.activity.mockResolvedValue(json({ runningConversations: 0 }));
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
  expect(await screen.findByText('No conversation is running right now.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Update to 1.0.1 now' }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('1.0.1'));
  expect(await screen.findByRole('status')).toBeTruthy();
});

test('the update confirmation says how many running conversations the restart stops', async () => {
  mocks.status.mockResolvedValue(json(status()));
  mocks.check.mockResolvedValue(json(offer));
  mocks.activity.mockResolvedValue(json({ runningConversations: 2 }));
  render(<ClaudeWebUpdateSection reload={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Update to 1.0.1' }));
  expect(await screen.findByText(/2 conversations are running now \(scheduled tasks included\); the restart stops them/)).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
});

test('explains an incompatible package without claiming that a restart or rollback happened', async () => {
  mocks.status.mockResolvedValue(json(status({}, { state: 'failed', error: 'CLAUDEWEB_PLATFORM_INCOMPATIBLE' })));
  render(<ClaudeWebUpdateSection reload={vi.fn()} />);
  const message = (await screen.findByRole('alert')).textContent;
  expect(message).toContain("This update cannot run on this server's system. The current version is still running and your data was kept.");
  expect(message).not.toContain('CLAUDEWEB_PLATFORM_INCOMPATIBLE');
  expect(mocks.update).not.toHaveBeenCalled();
});

test('updating to a version that is already installed shows up to date, not an error', async () => {
  mocks.status.mockResolvedValue(json(status()));
  mocks.check
    .mockResolvedValueOnce(json(offer))
    .mockResolvedValue(json({ installed: '1.0.1', latest: '1.0.1', newer: [] }));
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

test('with the default reload, an idle About tab reads the status once instead of in a loop', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    mocks.status.mockResolvedValue(json(status()));
    render(<ClaudeWebUpdateSection />);
    expect(await screen.findByText('1.0.0')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.status).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('the reload survives the re-render the finished status causes', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const reload = vi.fn();
    mocks.status
      .mockResolvedValueOnce(json(status({}, { state: 'restarting', version: '1.0.1', updated_at: Math.floor(Date.now() / 1000) })))
      .mockResolvedValue(json(status({ installed: '1.0.1' }, { state: 'done', version: '1.0.1' })));
    // A new function on every render, as an inline default used to be.
    function Host() {
      return <ClaudeWebUpdateSection reload={() => reload()} pageVersion="1.0.0" />;
    }
    render(<Host />);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await screen.findByText('Update finished. Reloading…')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1600);
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('once the server runs a newer version than the page, the old notes give way to a reload button', async () => {
  const reload = vi.fn();
  mocks.status.mockResolvedValue(json(status({ installed: '1.0.1' }, { state: 'done', version: '1.0.1' })));
  mocks.check.mockResolvedValue(json(offer));
  render(<ClaudeWebUpdateSection reload={reload} pageVersion="1.0.0" />);

  expect(await screen.findByText('ClaudeWeb 1.0.1 is installed. Reload the page to use it.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await waitFor(() => expect(mocks.check).toHaveBeenCalled());
  expect(screen.queryByText('Faster start')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update to 1.0.1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('an offer for the version now installed is not shown again', async () => {
  mocks.status.mockResolvedValue(json(status({ installed: '1.0.1' })));
  mocks.check.mockResolvedValue(json(offer));
  render(<ClaudeWebUpdateSection reload={vi.fn()} pageVersion="1.0.1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByText('ClaudeWeb is up to date.')).toBeTruthy();
  expect(screen.queryByText('Faster start')).toBeNull();
});

test('a second click while the update runs follows that update instead of failing', async () => {
  mocks.status
    .mockResolvedValueOnce(json(status()))
    .mockResolvedValue(json(status({}, { state: 'downloading', version: '1.0.1', updated_at: Math.floor(Date.now() / 1000) })));
  mocks.check.mockResolvedValue(json(offer));
  mocks.update.mockResolvedValue(refusal('CLAUDEWEB_UPDATE_RUNNING'));
  render(<ClaudeWebUpdateSection reload={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Update to 1.0.1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update to 1.0.1 now' }));
  expect(await screen.findByText('Downloading 1.0.1…')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('explains refusals, a version that needs a newer WebDesktop, and hides the check outside WebDesktop', async () => {
  mocks.status.mockResolvedValue(json(status()));
  mocks.check.mockResolvedValueOnce(json({ ...offer, newer: [{ ...offer.newer[0], compatible: false }] }));
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

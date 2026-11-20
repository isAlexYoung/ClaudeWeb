import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { api } from '@/shared/api';
import type { UsageDashboardData, UsageDashboardRange } from '@/shared/types';
import { UsageDashboard } from '@/modules/usage-dashboard';

vi.mock('@/shared/workspacePreferences', () => ({ useWorkspaceProfile: () => ({ displayName: 'Alex' }) }));
vi.mock('@/shared/context/SubscriptionQuotaContext', () => ({
  useSubscriptionQuota: () => ({ limits: [], plan: null, loading: false, stale: false, error: 'HTTP 401', refresh: vi.fn() }),
}));

const data = (range: UsageDashboardRange = 'all', messages = 10): UsageDashboardData => ({
  range, timeZone: 'UTC', start: '2026-11-15', end: '2026-11-15',
  summary: { sessions: 4, messages, total: 1400, tokens: { input: 1000, output: 200, cacheRead: 100, cacheCreate: 100 }, activeDays: 1, peakHour: 10, topModel: 'claude-opus-4-8' },
  byModel: [{ model: 'claude-opus-4-8', total: 1400, tokens: { input: 1000, output: 200, cacheRead: 100, cacheCreate: 100 } }],
  daily: [{ date: '2026-11-15', total: 1400, messages, tokens: { input: 1000, output: 200, cacheRead: 100, cacheCreate: 100 }, models: [{ model: 'claude-opus-4-8', total: 1400, tokens: { input: 1000, output: 200, cacheRead: 100, cacheCreate: 100 } }] }],
});
const response = (value = data()) => ({ ok: true, json: async () => value }) as Response;

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(() => { vi.restoreAllMocks(); });

describe('Code home usage dashboard', () => {
  it('loads real history, excludes the chat workspace, and keeps local history usable with quota 401', async () => {
    const request = vi.spyOn(api, 'usageDashboard').mockResolvedValue(response());
    render(<UsageDashboard />);
    await screen.findByText('Model messages');
    expect(request).toHaveBeenCalledWith('all', expect.any(String), '/home/claudeweb');
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Daily token activity' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Limits' }));
    expect(screen.getByText('HTTP 401')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'History period' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByText('Model messages')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('switches periods without letting a stale request overwrite the current range', async () => {
    let finish!: (value: Response) => void;
    vi.spyOn(api, 'usageDashboard').mockImplementation((range) => range === 'all'
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : Promise.resolve(response(data(range, 7))));
    render(<UsageDashboard />);
    expect(screen.getByRole('status', { name: 'Loading usage history' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await screen.findByText('7');
    await act(async () => { finish(response(data('all', 999))); });
    expect(screen.queryByText('999')).toBeNull();
    expect(screen.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers retry after a history failure without blocking other tabs', async () => {
    const request = vi.spyOn(api, 'usageDashboard').mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response());
    render(<UsageDashboard />);
    await screen.findByText(/Usage history is temporarily unavailable/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Model messages');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('recovers automatically after a transient plugin failure', async () => {
    const request = vi.spyOn(api, 'usageDashboard').mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValue(response());
    render(<UsageDashboard />);
    await screen.findByText('Model messages', {}, { timeout: 2000 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Usage history is temporarily unavailable/)).toBeNull();
  });

  it('does not repeatedly request a missing plugin or retry after leaving the page', async () => {
    const request = vi.spyOn(api, 'usageDashboard').mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    const view = render(<UsageDashboard />);
    await screen.findByText(/Usage history is temporarily unavailable/);
    expect(request).toHaveBeenCalledTimes(1);
    view.unmount();
    request.mockRejectedValue(new Error('offline'));
    const next = render(<UsageDashboard />);
    await act(async () => {});
    next.unmount();
    await new Promise(resolve => setTimeout(resolve, 800));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('shows a genuine empty state with no made-up model activity', async () => {
    vi.spyOn(api, 'usageDashboard').mockResolvedValue(response(data('7', 0)));
    render(<UsageDashboard />);
    await screen.findByText(/No Code usage recorded/);
    expect(screen.queryByRole('group', { name: 'Daily token activity' })).toBeNull();
  });

  it('supports keyboard tabs and presents cache-aware model totals', async () => {
    vi.spyOn(api, 'usageDashboard').mockResolvedValue(response());
    render(<UsageDashboard />);
    await screen.findByText('Model messages');
    const tab = screen.getByRole('tab', { name: 'Overview' });
    fireEvent.keyDown(tab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Models' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('img', { name: 'Tokens by date and model' })).toBeTruthy();
    expect(screen.getByText('100.0%')).toBeTruthy();
    expect(screen.getByText('Cache: 100 read · 100 written')).toBeTruthy();
  });

  it('uses Chinese labels and profile name in Chinese mode', async () => {
    await i18n.changeLanguage('zh-CN');
    vi.spyOn(api, 'usageDashboard').mockResolvedValue(response());
    render(<UsageDashboard />);
    await screen.findByText('模型消息');
    expect(screen.getByText('接下来做什么，Alex？')).toBeTruthy();
    expect(screen.getByRole('tab', { name: '概览' })).toBeTruthy();
    expect(screen.queryByText('Model messages')).toBeNull();
    await waitFor(() => expect(screen.getByRole('group', { name: '每日 Token 活跃图' })).toBeTruthy());
  });
});

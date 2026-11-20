import assert from 'node:assert/strict';

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { SubscriptionQuotaProvider } from '@/shared/context/SubscriptionQuotaContext';
import { QuotaDetails, QuotaRing } from '@/shared/ui/QuotaRing';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api', () => ({ api: { plugins: { rpc } } }));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

test('quota ring uses plugin windows and exact requested color thresholds', async () => {
  for (const [percent, tone] of [[70, 'blue'], [71, 'yellow'], [90, 'yellow'], [91, 'red']] as const) {
    rpc.mockResolvedValue({ ok: true, json: async () => ({ limits: [{ kind: 'session', label: '5h', percent }] }) });
    const view = render(<SubscriptionQuotaProvider><QuotaRing /></SubscriptionQuotaProvider>);
    await waitFor(() => assert.equal(view.getByRole('button').getAttribute('data-tone'), tone));
    assert.deepEqual(rpc.mock.calls.at(-1), ['claude-usage', 'GET', '/live']);
    view.unmount();
  }
});

test('opening the ring requests a live sync, coalesces repeated clicks and retains the previous reading until completion', async () => {
  rpc.mockResolvedValue({ ok: true, json: async () => ({ limits: [{ kind: 'session', label: '5h', percent: 35 }] }) });
  const view = render(<SubscriptionQuotaProvider><QuotaRing /></SubscriptionQuotaProvider>);
  const ring = await view.findByRole('button', { name: '5-hour limit: 35%' });
  let resolve!: (response: unknown) => void;
  rpc.mockImplementation(() => new Promise(done => { resolve = done; }));
  const before = rpc.mock.calls.length;
  fireEvent.click(ring); fireEvent.click(ring); fireEvent.click(ring);
  assert.equal(rpc.mock.calls.length, before + 1);
  assert.equal(rpc.mock.calls.at(-1)?.[2], '/live?refresh=1');
  assert.equal(ring.getAttribute('aria-busy'), 'true');
  assert.match(ring.getAttribute('aria-label') || '', /35%/);
  const popover = view.getByRole('dialog');
  assert.equal(popover.querySelector('.workspace-quota-note'), null, 'refresh adds no temporary row to the popover');
  assert.equal(view.getByRole('progressbar').getAttribute('aria-valuenow'), '35');
  await act(async () => { resolve({ ok: true, json: async () => ({ limits: [{ kind: 'session', label: '5h', percent: 42 }] }) }); });
  await view.findByRole('button', { name: '5-hour limit: 42%' });
  assert.equal(ring.getAttribute('aria-busy'), 'false');
  assert.equal(popover.querySelector('.workspace-quota-note'), null, 'completion keeps the same popover layout');
  assert.equal(view.getByRole('progressbar').getAttribute('aria-valuenow'), '42');
});

test('failed quota refresh preserves the last reading and marks it stale', async () => {
  rpc.mockResolvedValueOnce({ ok: true, json: async () => ({ limits: [{ kind: 'session', label: '5h', percent: 55 }] }) });
  const view = render(<SubscriptionQuotaProvider><QuotaRing /><QuotaDetails /></SubscriptionQuotaProvider>);
  await view.findByRole('button', { name: '5-hour limit: 55%' });
  rpc.mockRejectedValueOnce(new Error('Please retry later'));
  fireEvent.click(view.getByRole('button', { name: 'Refresh' }));
  await view.findByRole('button', { name: '5-hour limit: 55% (last reading)' });
  assert.match(view.getByRole('status').textContent || '', /retry later/);
});

test('a missing subscription never displays a fabricated quota', async () => {
  rpc.mockResolvedValue({ ok: true, json: async () => ({ limits: [], error: 'OAuth required' }) });
  const view = render(<SubscriptionQuotaProvider><QuotaRing /></SubscriptionQuotaProvider>);
  const ring = await view.findByRole('button', { name: 'Quota unavailable' });
  assert.equal(ring.getAttribute('data-tone'), 'unknown');
  assert.equal(ring.querySelector('.quota-fill'), null);
});

test('the ring opens the plan limits in a popover; See all leaves for Settings', async () => {
  const resetsAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  rpc.mockResolvedValue({ ok: true, json: async () => ({ plan: 'pro', limits: [
    { kind: 'session', label: '5h', percent: 35, resetsAt },
    { kind: 'weekly_all', label: 'Weekly (all models)', percent: 37, resetsAt: null },
  ] }) });
  const seeAll = vi.fn();
  const view = render(<SubscriptionQuotaProvider><QuotaRing onSeeAll={seeAll} /></SubscriptionQuotaProvider>);
  const ring = await view.findByRole('button', { name: '5-hour limit: 35%' });
  assert.equal(view.queryByRole('dialog'), null, 'closed until clicked');

  fireEvent.click(ring);
  const popover = await view.findByRole('dialog');
  assert.match(popover.textContent || '', /Plan usage limits · Pro/);
  assert.match(popover.textContent || '', /5-hour limit/);
  assert.match(popover.textContent || '', /Resets/);
  assert.match(popover.textContent || '', /35%/);
  assert.match(popover.textContent || '', /Weekly · all models/);
  assert.deepEqual(view.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-valuenow')), ['35', '37']);

  fireEvent.click(view.getByRole('button', { name: 'See all →' }));
  assert.equal(seeAll.mock.calls.length, 1);
  // And the popover closes.
  await waitFor(() => assert.equal(view.queryByRole('dialog'), null));
});

test('weekly-only quotas omit the 5-hour window and show no external reset links', async () => {
  rpc.mockResolvedValue({ ok: true, json: async () => ({ plan: 'Ultra', limits: [{ kind: 'weekly_all', label: 'Weekly (all models)', percent: 28 }] }) });
  const view = render(<SubscriptionQuotaProvider><QuotaDetails /></SubscriptionQuotaProvider>);
  await view.findByText('Weekly · all models');
  assert.equal(view.queryByText('5-hour limit'), null);
  assert.equal(view.queryByRole('link'), null);
  assert.equal(view.container.textContent?.includes('reset cards'), false);
});

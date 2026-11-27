import assert from 'node:assert/strict';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { useConnectorStatus } from '@/modules/project-workspace/hooks/useConnectorStatus';

const harness = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { providers: { mcpConnections: harness.request } } }));
const response = (name: string, status: string) => ({ ok: true, json: async () => ({ data: { servers: [{ name, status }] } }) });
const flush = () => act(async () => { await Promise.resolve(); });
beforeEach(() => { vi.useFakeTimers(); harness.request.mockReset(); });
afterEach(() => vi.useRealTimers());

test('live connectors refresh without reload and stop polling while collapsed or disabled', async () => {
  harness.request.mockResolvedValue(response('linux-pc-files', 'connected'));
  const view = renderHook(({ enabled }) => useConnectorStatus('/repo', 's1', enabled), { initialProps: { enabled: false } });
  assert.equal(harness.request.mock.calls.length, 0);
  view.rerender({ enabled: true });
  await flush();
  assert.deepEqual(view.result.current.servers, [{ name: 'linux-pc-files', status: 'connected' }]);
  harness.request.mockResolvedValue(response('linux-pc-files', 'disconnected'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  assert.equal(view.result.current.servers[0].status, 'disconnected');
  view.rerender({ enabled: false });
  const count = harness.request.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  assert.equal(harness.request.mock.calls.length, count);
  assert.deepEqual(view.result.current.servers, []);
});

test('a connector that is not started yet keeps its own status instead of being dropped', async () => {
  harness.request.mockResolvedValue(response('docs', 'idle'));
  const view = renderHook(() => useConnectorStatus('/repo', 's1', true));
  await flush();
  assert.deepEqual(view.result.current.servers, [{ name: 'docs', status: 'idle' }]);
});

test('navigation cancels the old lookup and ignores a late response from another session', async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  harness.request.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockResolvedValue(response('new-server', 'connecting'));
  const view = renderHook(({ id }) => useConnectorStatus('/repo', id, true), { initialProps: { id: 'old' } });
  const signal = harness.request.mock.calls[0][2].signal as AbortSignal;
  view.rerender({ id: 'new' });
  await flush();
  assert.equal(signal.aborted, true);
  await act(async () => { resolveOld(response('old-server', 'connected')); });
  assert.deepEqual(view.result.current.servers, [{ name: 'new-server', status: 'connecting' }]);
  harness.request.mockResolvedValue({ ok: false, status: 503 });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  assert.equal(view.result.current.error, true);
  assert.deepEqual(view.result.current.servers, []);
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { useMcpServers } from '@/modules/mcp/hooks/useMcpServers';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { providers: { mcpServers: mocks.list } } }));

beforeEach(() => { mocks.list.mockReset(); });

it('equivalent project arrays do not reload MCP after the cache expires', async () => {
  mocks.list.mockImplementation(async (_provider, { scope }) => Response.json({ success: true, data: { servers: scope === 'user' ? [{ name: 'retained' }] : [] } }));
  const project = { projectId: 'stable', path: '/stable-project', displayName: 'Stable' };
  const { result, rerender } = renderHook(({ projects }) => useMcpServers({ selectedProvider: 'claude', currentProjects: projects }), { initialProps: { projects: [project] } });
  await waitFor(() => expect(result.current.servers).toHaveLength(1));
  const calls = mocks.list.mock.calls.length;
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 10 * 60_000);
  try {
    rerender({ projects: [{ ...project }] });
    await act(async () => { await Promise.resolve(); });
    expect(mocks.list).toHaveBeenCalledTimes(calls);
  } finally { clock.mockRestore(); }
});

it('forced refresh keeps the visible snapshot, then removes deleted servers atomically', async () => {
  mocks.list.mockImplementation(async () => Response.json({ success: true, data: { servers: [{ name: 'old-server' }] } }));
  const projects = [{ projectId: 'atomic', path: '/atomic-project' }];
  const { result } = renderHook(() => useMcpServers({ selectedProvider: 'claude', currentProjects: projects }));
  await waitFor(() => expect(result.current.servers.length).toBeGreaterThan(0));
  const count = result.current.servers.length;
  const releases: Array<() => void> = [];
  mocks.list.mockImplementation(() => new Promise<Response>(resolve => releases.push(() => resolve(Response.json({ success: true, data: { servers: [] } })))));
  let refreshing: Promise<void>;
  act(() => { refreshing = result.current.refreshServers({ force: true }); });
  expect(result.current.servers).toHaveLength(count);
  expect(result.current.isLoading).toBe(false);
  await act(async () => { releases.forEach(release => release()); await refreshing; });
  expect(result.current.servers).toEqual([]);
});

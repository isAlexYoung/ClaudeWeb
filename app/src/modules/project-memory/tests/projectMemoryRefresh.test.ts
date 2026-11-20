import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useProjectMemory } from '@/modules/project-memory/hooks/useProjectMemory';
import type { ProjectMemorySnapshot } from '@/shared/types';

afterEach(() => vi.useRealTimers());

const snapshot: ProjectMemorySnapshot = { projectId: 'p1', path: '/repo/CLAUDE.md', version: 'v1', entries: [] };
const response = (data = snapshot) => new Response(JSON.stringify(data), { status: 200 });

test('periodic refresh preserves loaded rows and empty state without another loading row or snapshot replacement', async () => {
  vi.useFakeTimers();
  let resolve!: (value: Response) => void;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response()).mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = renderHook(() => useProjectMemory('p1', true));
  await act(async () => {});
  expect(view.result.current.loading).toBe(false);
  const loaded = view.result.current.data;
  act(() => vi.advanceTimersByTime(10_000));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(view.result.current.data).toBe(loaded);
  expect(view.result.current.loading).toBe(false);
  await act(async () => { resolve(response()); });
  expect(view.result.current.data).toBe(loaded);
  expect(view.result.current.loading).toBe(false);
});

test('changed file snapshots still update and switching projects hides cached data while its first read waits', async () => {
  let resolve!: (value: Response) => void;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
  const view = renderHook(({ projectId }) => useProjectMemory(projectId, false), { initialProps: { projectId: 'p1' } });
  await act(async () => {});
  fetcher.mockResolvedValue(response({ ...snapshot, version: 'v2' }));
  await act(async () => { await view.result.current.refresh(); });
  expect(view.result.current.data?.version).toBe('v2');
  fetcher.mockImplementation(() => new Promise(done => { resolve = done; }));
  view.rerender({ projectId: 'p2' });
  expect(view.result.current.data).toBeNull();
  expect(view.result.current.loading).toBe(true);
  await act(async () => { resolve(response({ ...snapshot, projectId: 'p2' })); });
  expect(view.result.current.data?.projectId).toBe('p2');
});

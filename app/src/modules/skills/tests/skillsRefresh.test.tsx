import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { useProviderSkills } from '@/modules/skills/hooks/useProviderSkills';

const mocks = vi.hoisted(() => ({ list: vi.fn(), importSkill: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { providers: { skills: mocks.list, importSkill: mocks.importSkill } } }));

it('refresh leaves installed skills visible and drops removed skills when complete', async () => {
  mocks.list.mockImplementation(async () => Response.json({ success: true, data: { skills: [{ name: 'Existing', command: '/existing', sourcePath: '/skills/existing/SKILL.md', scope: 'user' }] } }));
  const { result } = renderHook(() => useProviderSkills({ selectedProvider: 'claude', currentProjects: [{ projectId: 'skills-test', path: '/skills-test' }] }));
  await waitFor(() => expect(result.current.skills).toHaveLength(1));
  const releases: Array<() => void> = [];
  mocks.list.mockImplementation(() => new Promise<Response>(resolve => releases.push(() => resolve(Response.json({ success: true, data: { skills: [] } })))));
  let refreshing: Promise<void>;
  act(() => { refreshing = result.current.refreshSkills({ force: true }); });
  expect(result.current.skills[0].name).toBe('Existing');
  expect(result.current.isLoading).toBe(false);
  await act(async () => { releases.forEach(release => release()); await refreshing; });
  expect(result.current.skills).toEqual([]);
});

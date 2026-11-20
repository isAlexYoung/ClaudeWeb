import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { Project, SidebarProjectListProps } from '@/shared/types';

/**
 * Bulk-deleting a project's sessions through the sidebar controller: confirming
 * deletes every id once, keeps the rest of the sidebar in step and says so when
 * only some of them went; a session that starts running is never deleted.
 */

const deleteSession = vi.fn();
const getArchivedSessions = vi.fn();
const recentConversations = vi.fn();
const alertMock = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    deleteSession: (sessionId: string, hardDelete?: boolean) => deleteSession(sessionId, hardDelete),
    archivedProjects: () => Promise.resolve({ ok: true, json: async () => ({ data: { projects: [] } }) }),
    getArchivedSessions: () => getArchivedSessions(),
    recentConversations: () => recentConversations(),
    migrateLegacyProjectStars: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  },
}));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');

const NOW = new Date('2026-08-21T10:00:00.000Z');
const noop = () => {};

// Keys come back with their interpolation options appended (`key:count=2,total=3`),
// so a label or a message can be asserted together with the numbers it was given.
const t = ((key: string, options?: unknown) =>
  options && typeof options === 'object'
    ? `${key}:${Object.entries(options).map(([name, value]) => `${name}=${String(value)}`).join(',')}`
    : key) as unknown as SidebarProjectListProps['t'];

const PROJECT = {
  projectId: 'project-1',
  name: 'project-1',
  displayName: 'project one',
  fullPath: '/repo',
  sessions: [],
} as unknown as Project;

// Held outside the hook call: `projects` is an effect dependency in the
// controller, so rebuilding the array per render would re-run those effects
// forever instead of testing anything.
const PROJECTS = [PROJECT];

const NO_IDS: ReadonlySet<string> = new Set<string>();

const jsonResponse = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) });

beforeEach(() => {
  localStorage.clear();
  deleteSession.mockReset();
  deleteSession.mockResolvedValue({ ok: true, text: async () => '' });
  getArchivedSessions.mockReset();
  getArchivedSessions.mockImplementation(() => jsonResponse({ sessions: [] }));
  recentConversations.mockReset();
  recentConversations.mockImplementation(() => jsonResponse({ conversations: [], total: 0, hasMore: false }));
  alertMock.mockReset();
  vi.stubGlobal('alert', alertMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type SessionActivity = {
  selectedProject?: Project | null;
  keepProjectsExpanded?: boolean;
  activeSessions: ReadonlySet<string>;
  backgroundSessionIds: ReadonlySet<string>;
};

const IDLE: SessionActivity = { activeSessions: NO_IDS, backgroundSessionIds: NO_IDS };

const renderController = (onSessionDelete = vi.fn(), initialActivity: SessionActivity = IDLE) =>
  renderHook(
    ({ activeSessions, backgroundSessionIds, keepProjectsExpanded, selectedProject = null }: SessionActivity) =>
      useSidebarController({
        projects: PROJECTS,
        selectedProject,
        selectedSession: null,
        activeSessions,
        backgroundSessionIds,
        isLoading: false,
        isMobile: false,
        t,
        onRefresh: noop,
        onProjectSelect: noop,
        onSessionSelect: noop,
        onSessionDelete,
        onLoadMoreSessions: noop,
        onProjectDelete: noop,
        setCurrentProject: noop,
        setSidebarVisible: noop,
        sidebarVisible: true,
        keepProjectsExpanded,
      }),
    { initialProps: initialActivity },
  );

// A deleteSession response the test settles by hand, to look at the sidebar
// while the requests are still out.
const deferredDelete = () => {
  let settle: (response: { ok: boolean; text: () => Promise<string> }) => void = noop;
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, succeed: () => settle({ ok: true, text: async () => '' }) };
};

test('confirming a bulk delete deletes every id once and clears the selection', async () => {
  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);

  act(() => {
    result.current.setProjectSessionSelection({ projectId: 'project-1', sessionIds: new Set(['s1', 's2']) });
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });

  assert.deepEqual(result.current.pendingDeletion, { kind: 'sessions', sessionIds: ['s1', 's2'] });

  await act(async () => {
    await result.current.confirmDeleteSessions(true);
  });

  assert.deepEqual(deleteSession.mock.calls, [['s1', true], ['s2', true]]);
  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s2']]);
  assert.equal(result.current.pendingDeletion, null);
  assert.equal(result.current.sessionSelection, null);
  assert.equal(alertMock.mock.calls.length, 0);
});

test('a bulk delete that only partly succeeds keeps the failed rows ticked and says how many failed', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  deleteSession.mockImplementation((sessionId: string) =>
    sessionId === 's2'
      ? Promise.resolve({ ok: false, status: 500, text: async () => 'boom' })
      : Promise.resolve({ ok: true, text: async () => '' }),
  );

  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);

  act(() => {
    result.current.setProjectSessionSelection({ projectId: 'project-1', sessionIds: new Set(['s1', 's2', 's3']) });
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2', 's3']);
  });

  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });

  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s3']], 'the sessions that went are still reported');
  assert.deepEqual(alertMock.mock.calls, [['messages.deleteSessionsPartialFailure:count=1,total=3']]);
  assert.equal(result.current.sessionSelection?.projectId, 'project-1');
  assert.deepEqual(
    [...(result.current.sessionSelection?.sessionIds ?? [])],
    ['s2'],
    'the row that could not be deleted stays ticked for a retry',
  );
  consoleError.mockRestore();
});

test('a bulk delete prunes the recents feed, lowers its total and refetches the archive', async () => {
  recentConversations.mockImplementation(() =>
    jsonResponse({
      conversations: ['s1', 's2', 's9'].map((sessionId) => ({ sessionId, provider: 'claude', projectId: 'project-1' })),
      total: 7,
      hasMore: true,
    }),
  );
  const { result } = renderController();

  act(() => {
    result.current.setSearchMode('conversations');
  });
  await waitFor(() => assert.equal(result.current.recentConversations.length, 3));
  assert.equal(result.current.recentConversationsTotal, 7);
  const archiveFetchesBefore = getArchivedSessions.mock.calls.length;

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });
  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });

  assert.deepEqual(result.current.recentConversations.map((conversation) => conversation.sessionId), ['s9']);
  assert.equal(result.current.recentConversationsTotal, 5, 'the total drops by the rows that left the feed');
  assert.equal(getArchivedSessions.mock.calls.length, archiveFetchesBefore + 1, 'the archive is refetched once');
});

test('accepting the dialog ends selection mode at once, and a second confirmation cannot resend the same ids', async () => {
  const pending = { s1: deferredDelete(), s2: deferredDelete() };
  deleteSession.mockImplementation((sessionId: 's1' | 's2') => pending[sessionId].promise);
  const onSessionDelete = vi.fn();
  const { result } = renderController(onSessionDelete);
  // Read through a function so the assertion below that the selection is gone
  // does not narrow it to `null` for the rest of the test.
  const tickedSessionIds = () => [...(result.current.sessionSelection?.sessionIds ?? [])];

  act(() => {
    result.current.setProjectSessionSelection({ projectId: 'project-1', sessionIds: new Set(['s1', 's2']) });
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });

  let firstConfirmation: Promise<void> = Promise.resolve();
  act(() => {
    firstConfirmation = result.current.confirmDeleteSessions(false);
  });
  assert.equal(result.current.sessionSelection, null, 'the Delete button is gone while the requests are out');

  // The rows are still on screen, so they can be ticked and confirmed again.
  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2']);
  });
  await act(async () => {
    await result.current.confirmDeleteSessions(false);
  });
  assert.deepEqual(deleteSession.mock.calls, [['s1', false], ['s2', false]], 'no id is sent twice');

  // A selection started meanwhile belongs to the user, not to the delete.
  act(() => {
    result.current.toggleSessionSelected('project-1', 's3');
  });

  await act(async () => {
    pending.s1.succeed();
    pending.s2.succeed();
    await firstConfirmation;
  });

  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s2']]);
  assert.deepEqual(tickedSessionIds(), ['s3']);
  assert.equal(alertMock.mock.calls.length, 0, 'nothing failed, so nothing is reported');
});

test('a session that starts a response while the dialog is open is skipped, not deleted or counted as failed', async () => {
  const onSessionDelete = vi.fn();
  const { result, rerender } = renderController(onSessionDelete);

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation(['s1', 's2', 's3']);
  });

  // s2 now has a response in flight; s3 is busy only with background work,
  // which the rows treat as deletable too.
  rerender({ activeSessions: new Set(['s2', 's3']), backgroundSessionIds: new Set(['s3']) });

  await act(async () => {
    await result.current.confirmDeleteSessions(true);
  });

  assert.deepEqual(deleteSession.mock.calls, [['s1', true], ['s3', true]]);
  assert.deepEqual(onSessionDelete.mock.calls, [['s1'], ['s3']]);
  assert.equal(alertMock.mock.calls.length, 0);
});

test('the confirmation callback keeps its identity while rows are ticked', async () => {
  const { result } = renderController();
  await waitFor(() => assert.equal(result.current.sessionSelection, null));

  const before = result.current.showDeleteSelectedSessionsConfirmation;

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.toggleSessionSelected('project-1', 's2');
  });

  assert.deepEqual([...(result.current.sessionSelection?.sessionIds ?? [])], ['s1', 's2']);
  assert.equal(
    result.current.showDeleteSelectedSessionsConfirmation,
    before,
    'a callback that changes per tick re-renders every memoized project row',
  );
});

test('ticking a row of another project starts that project over', () => {
  const { result } = renderController();

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.toggleSessionSelected('project-2', 'other');
  });

  assert.equal(result.current.sessionSelection?.projectId, 'project-2');
  assert.deepEqual([...(result.current.sessionSelection?.sessionIds ?? [])], ['other']);
});

test('the selection is dropped when the project collapses or the tab changes', () => {
  const { result } = renderController();

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.toggleProject('project-1');
  });
  assert.equal(result.current.sessionSelection, null, 'collapsing takes the ticked rows off screen');

  act(() => {
    result.current.toggleSessionSelected('project-1', 's1');
  });
  act(() => {
    result.current.setSearchMode('conversations');
  });
  assert.equal(result.current.sessionSelection, null, 'so does leaving the Projects tab');
});

test('an empty selection opens no confirmation', () => {
  const { result } = renderController();

  act(() => {
    result.current.showDeleteSelectedSessionsConfirmation([]);
  });

  assert.equal(result.current.pendingDeletion, null);
});


test('New chat selecting the chat directory does not open it as a project, a real project still opens', () => {
  // Older ClaudeWeb installs kept projects in /home/wdguest, so it can be listed as a project.
  const chatDirectory = { projectId: 'chat-dir', displayName: 'wdguest', fullPath: '/home/wdguest/', path: '/home/wdguest' } as unknown as Project;
  const view = renderController(vi.fn(), { ...IDLE, selectedProject: chatDirectory });
  assert.equal(view.result.current.isProjectExpanded('chat-dir'), false);

  view.rerender({ ...IDLE, selectedProject: { ...PROJECTS[0] } });
  assert.equal(view.result.current.isProjectExpanded(PROJECTS[0].projectId), true);
});

test('project expansion remains an accordion by default', () => {
  const { result } = renderController();
  act(() => result.current.toggleProject('project-1'));
  act(() => result.current.toggleProject('project-2'));
  assert.equal(result.current.isProjectExpanded('project-1'), false);
  assert.equal(result.current.isProjectExpanded('project-2'), true);
});

test('opt-in multi-open groups survive reloads and toggle independently', () => {
  const first = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  act(() => first.result.current.toggleProject('project-1'));
  act(() => first.result.current.toggleProject('project-2'));
  assert.equal(first.result.current.isProjectExpanded('project-1'), true);
  assert.equal(first.result.current.isProjectExpanded('project-2'), true);
  first.unmount();
  const restored = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  assert.equal(restored.result.current.isProjectExpanded('project-1'), true);
  assert.equal(restored.result.current.isProjectExpanded('project-2'), true);
  act(() => restored.result.current.toggleProject('project-1'));
  assert.equal(restored.result.current.isProjectExpanded('project-1'), false);
  assert.equal(restored.result.current.isProjectExpanded('project-2'), true);
});

test('hydrating the preference restores groups before writing browser storage', () => {
  localStorage.setItem('claudeweb-expanded-projects', JSON.stringify(['saved-1', 'saved-2']));
  const controller = renderController();
  controller.rerender({ ...IDLE, keepProjectsExpanded: true });
  assert.equal(controller.result.current.isProjectExpanded('saved-1'), true);
  assert.equal(controller.result.current.isProjectExpanded('saved-2'), true);
  controller.rerender({ ...IDLE, keepProjectsExpanded: false });
  assert.equal(controller.result.current.isProjectExpanded('saved-2'), false);
  assert.deepEqual(JSON.parse(localStorage.getItem('claudeweb-expanded-projects')!), ['saved-1', 'saved-2']);
});

test('invalid saved expansion data does not break navigation', () => {
  localStorage.setItem('claudeweb-expanded-projects', 'invalid JSON');
  const { result } = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  act(() => result.current.toggleProject('project-1'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
});

test('only string project IDs are restored from browser storage', () => {
  localStorage.setItem('claudeweb-expanded-projects', JSON.stringify(['saved-1', 5, null, {}, 'saved-2']));
  const { result } = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  assert.equal(result.current.isProjectExpanded('saved-1'), true);
  assert.equal(result.current.isProjectExpanded('saved-2'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem('claudeweb-expanded-projects')!), ['saved-1', 'saved-2']);
});


test('unavailable browser storage does not prevent opening projects', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  const { result } = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  act(() => result.current.toggleProject('project-1'));
  act(() => result.current.toggleProject('project-2'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
  assert.equal(result.current.isProjectExpanded('project-2'), true);
});

test('Running groups keep their independent collapse state in multi-open mode', () => {
  const { result } = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  act(() => result.current.toggleProject('project-1'));
  act(() => result.current.setSearchMode('running'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
  act(() => result.current.toggleProject('project-1'));
  assert.equal(result.current.isProjectExpanded('project-1'), false);
  act(() => result.current.setSearchMode('projects'));
  assert.equal(result.current.isProjectExpanded('project-1'), true);
});


test('a selected project intentionally collapsed before reload stays collapsed', () => {
  localStorage.setItem('claudeweb-expanded-projects', JSON.stringify(['other-project']));
  const controller = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true, selectedProject: PROJECT });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), false);
  assert.equal(controller.result.current.isProjectExpanded('other-project'), true);
  assert.deepEqual(JSON.parse(localStorage.getItem('claudeweb-expanded-projects')!), ['other-project']);
  controller.rerender({ ...IDLE, keepProjectsExpanded: true, selectedProject: { ...PROJECT, projectId: 'new-selection' } });
  assert.equal(controller.result.current.isProjectExpanded('new-selection'), true);
});

test('an empty saved set also preserves a collapsed selection restored after mount', () => {
  localStorage.setItem('claudeweb-expanded-projects', '[]');
  const controller = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true });
  controller.rerender({ ...IDLE, keepProjectsExpanded: true, selectedProject: PROJECT });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), false);
  assert.equal(localStorage.getItem('claudeweb-expanded-projects'), '[]');
});

test('without saved expansion, initial project selection still opens normally', () => {
  const controller = renderController(vi.fn(), { ...IDLE, keepProjectsExpanded: true, selectedProject: PROJECT });
  assert.equal(controller.result.current.isProjectExpanded(PROJECT.projectId), true);
});

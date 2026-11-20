import assert from 'node:assert/strict';

import { fireEvent, render, within } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { WorkspaceExperienceProvider } from '@/shared/context/WorkspaceExperienceContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type { ArchivedSessionListItem, Project, ProjectSession, SidebarProjectListProps } from '@/shared/types';
import IntegratedSidebar from '@/modules/sidebar/IntegratedSidebar';

vi.mock('@/shared/api', () => ({
  api: {
    sessionDetails: vi.fn(async () => ({ ok: false })),
    deleteSession: vi.fn(async () => ({ ok: true })),
    deleteProject: vi.fn(async () => ({ ok: true })),
    assets: {
      projectFiles: vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })),
    },
  },
  readApiJson: async (response: Response) => response.json(),
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { username: 'alex' }, logout: () => {} }) }));
// Conversations started by a scheduled task, as the scheduled-tasks module reports them.
const scheduled = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('@/modules/scheduled-tasks', () => ({ useScheduledTaskSessionIds: () => scheduled.ids }));

const SESSION: ProjectSession = { id: 'session-1', summary: 'Fix the build', __provider: 'claude' };
const PROJECT = {
  projectId: 'project-1',
  displayName: 'Website',
  fullPath: '/srv/website',
  path: '/srv/website',
  sessions: [SESSION],
} as unknown as Project;
// The standalone-chat directory, renamed by the user: it is still recognised by its path.
const CHAT_PROJECT = {
  projectId: 'chat-project',
  displayName: 'Renamed chat folder',
  fullPath: '/home/claudeweb',
  path: '/home/claudeweb',
  sessions: [{ id: 'chat-1', summary: 'Hello', __provider: 'claude' }],
} as unknown as Project;

const createList = (overrides: Partial<SidebarProjectListProps> = {}) => ({
  projects: [PROJECT, CHAT_PROJECT],
  filteredProjects: [PROJECT, CHAT_PROJECT],
  selectedProject: null,
  selectedSession: null,
  activeRename: null,
  activeSessions: new Set<string>(),
  backgroundSessionIds: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  loadingMoreProjects: new Set<string>(),
  getProjectSessions: (project: Project) => (project.sessions || []) as ProjectSession[],
  isProjectExpanded: () => true,
  isProjectStarred: () => false,
  onToggleProject: vi.fn(),
  onToggleStarProject: vi.fn(),
  onStartEditingProject: vi.fn(),
  onCancelEditingProject: vi.fn(),
  onSaveProjectName: vi.fn(),
  onDeleteProject: vi.fn(),
  onSessionSelect: vi.fn(),
  onNewSession: vi.fn(),
  onLoadMoreSessions: vi.fn(),
  onRenameDraftChange: vi.fn(),
  onStartEditingSession: vi.fn(),
  onCancelEditingSession: vi.fn(),
  onSaveEditingSession: vi.fn(),
  onDeleteSession: vi.fn(),
  ...overrides,
}) as unknown as SidebarProjectListProps;

const renderSidebar = (list = createList(), props: Record<string, unknown> = {}) => render(
  <WorkspaceExperienceProvider>
    <IntegratedSidebar
      list={list}
      collapsed={false}
      onCollapse={() => {}}
      onExpand={() => {}}
      onSettings={() => {}}
      onRefresh={() => {}}
      onCreateProject={() => {}}
      recent={[]}
      recentHasMore={false}
      isLoadingMoreRecent={false}
      onLoadMoreRecent={() => {}}
      archivedProjects={[]}
      archivedSessions={[]}
      searchFilter=""
      searchMode="conversations"
      onSearch={() => {}}
      onSearchMode={() => {}}
      searchResults={null}
      isSearching={false}
      onRestoreProject={() => {}}
      onRestoreSession={() => {}}
      onDeleteArchivedSession={() => {}}
      {...props}
    />
  </WorkspaceExperienceProvider>,
);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  scheduled.ids = new Set();
  resetUserPreferences();
  localStorage.clear();
  // chat-1 was started from New Chat, so it belongs to the Chats section.
  writeUserPreference('workspaceSessions', { chatSessionIds: ['chat-1'], pinnedSessionIds: [] });
});

test('a conversation row can be renamed and deleted through the existing sidebar flows', () => {
  const list = createList();
  const view = renderSidebar(list);
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  const row = view.getByRole('button', { name: 'Fix the build' }).closest('.workspace-nav-row') as HTMLElement;

  fireEvent.click(within(row).getByRole('button', { name: 'Rename conversation' }));
  assert.deepEqual((list.onStartEditingSession as ReturnType<typeof vi.fn>).mock.calls, [['project-1', 'session-1', 'Fix the build']]);

  // Delete opens the existing confirmation, which offers archiving or deleting for good.
  fireEvent.click(within(row).getByRole('button', { name: 'Delete conversation…' }));
  assert.deepEqual((list.onDeleteSession as ReturnType<typeof vi.fn>).mock.calls, [['session-1', 'Fix the build']]);
});

test('every matching message opens with its own identity and a fresh search navigation request', () => {
  const list = createList();
  const view = renderSidebar(list, { searchFilter: 'hello', searchResults: { query: 'hello', totalMatches: 2, titleResults: [], results: [{ projectId: PROJECT.projectId, projectName: 'Website', projectDisplayName: 'Website', sessions: [{ sessionId: SESSION.id, sessionSummary: 'Fix the build', matches: [
    { role: 'user', snippet: 'hello first hit', timestamp: '2026-11-19T01:00:00Z', messageUuid: 'u1', highlights: [] },
    { role: 'assistant', snippet: 'hello second hit', timestamp: '2026-11-19T01:00:01Z', messageUuid: 'a1', highlights: [] },
  ] }] }] } });
  fireEvent.click(view.getByRole('button', { name: 'Search' }));
  fireEvent.click(view.getByRole('button', { name: /hello second hit/ }));
  const selected = (list.onSessionSelect as ReturnType<typeof vi.fn>).mock.calls[0][0];
  assert.equal(selected.__searchTargetMessageUuid, 'a1');
  assert.equal(selected.__searchTargetSnippet, 'hello second hit');
  assert.equal(selected.__searchTargetRole, 'assistant');
  assert.equal(selected.__searchTargetTimestamp, '2026-11-19T01:00:01Z');
  fireEvent.click(view.getByRole('button', { name: 'Search' }));
  fireEvent.click(view.getByRole('button', { name: /hello second hit/ }));
  const again = (list.onSessionSelect as ReturnType<typeof vi.fn>).mock.calls[1][0];
  assert.notEqual(selected.__searchTargetRequest, again.__searchTargetRequest);
});

test('sidebar refresh is visibly busy and rejects repeated clicks until its request finishes', () => {
  const refresh = vi.fn();
  const view = renderSidebar(createList(), { onRefresh: refresh, isRefreshing: true });
  const button = view.getByRole('button', { name: 'Refresh' }) as HTMLButtonElement;
  assert.equal(button.disabled, true); assert.equal(button.getAttribute('aria-busy'), 'true');
  fireEvent.click(button); assert.equal(refresh.mock.calls.length, 0);
});

test('only the clicked occurrence is selected across Pinned, Project and Recent', () => {
  writeUserPreference('workspaceSessions', { chatSessionIds: [], pinnedSessionIds: [SESSION.id] });
  const view = renderSidebar(createList({ selectedProject: PROJECT, selectedSession: SESSION }), {
    recent: [{ sessionId: SESSION.id, projectId: PROJECT.projectId, sessionTitle: SESSION.summary, provider: 'claude' }],
  });
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  const rows = view.getAllByRole('button', { name: 'Fix the build' }).map((button) => button.closest('.workspace-nav-row')!);
  assert.equal(rows.length, 3);
  assert.equal(view.container.querySelectorAll('.workspace-nav-row.selected').length, 1);
  for (const row of [rows[2], rows[1], rows[0]]) {
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Fix the build' }));
    assert.equal(row.classList.contains('selected'), true);
    assert.equal(view.container.querySelectorAll('.workspace-nav-row.selected').length, 1);
  }
});

test('the project menu opens the project File management page', async () => {
  const view = renderSidebar();
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  fireEvent.click(view.getByRole('button', { name: 'Website project actions' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'File management' }));

  const page = view.getByRole('dialog', { name: 'File management · Website' });
  await within(page).findByText('No files have been uploaded in this project yet.');
  fireEvent.click(within(page).getByRole('button', { name: 'Close' }));
  assert.equal(view.queryByRole('dialog', { name: 'File management · Website' }), null);
});

test('an open conversation rename saves through the sidebar controller', () => {
  const list = createList({ activeRename: { target: 'session', id: 'session-1', projectId: 'project-1', draft: 'Fix CI' } });
  const view = renderSidebar(list);

  const dialog = view.getByRole('dialog');
  assert.equal((within(dialog).getByRole('textbox', { name: 'Conversation name' }) as HTMLInputElement).value, 'Fix CI');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }));
  assert.deepEqual((list.onSaveEditingSession as ReturnType<typeof vi.fn>).mock.calls, [['project-1', 'session-1', 'Fix CI', 'claude']]);
});

test('Scheduled tasks sits under New chat and marks the conversations a task started', () => {
  scheduled.ids = new Set(['session-1']);
  const view = renderSidebar();
  const entry = view.getByRole('button', { name: 'Scheduled tasks' });
  const newChat = view.getByRole('button', { name: 'New chat' });
  assert.equal(newChat.nextElementSibling, entry);
  assert.equal(entry.getAttribute('aria-pressed'), 'false');
  fireEvent.click(entry);
  assert.equal(entry.getAttribute('aria-pressed'), 'true');

  assert.equal(view.getByRole('button', { name: 'Hello' }).getAttribute('data-scheduled'), null);
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.equal(view.getByRole('button', { name: 'Fix the build' }).getAttribute('data-scheduled'), 'true');
});

test('legacy Chat-directory conversations stay in Chats, even without a saved mode classification', () => {
  const legacy = {
    ...CHAT_PROJECT,
    sessions: [{ id: 'chat-1', summary: 'Hello', __provider: 'claude' }, { id: 'old-1', summary: 'Old project chat', __provider: 'claude' }],
  } as unknown as Project;
  const view = renderSidebar(createList({ projects: [PROJECT, legacy], filteredProjects: [PROJECT, legacy], selectedProject: legacy }));
  assert.equal(view.queryByRole('button', { name: 'Renamed chat folder' }), null);
  assert.ok(view.getByRole('button', { name: 'Old project chat' }));
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.equal(view.queryByRole('button', { name: 'Old project chat' }), null);

  view.unmount();
  const project = renderSidebar(createList({ selectedProject: PROJECT }));
  fireEvent.click(project.getByRole('tab', { name: 'Project' }));
  const projectRow = project.getByRole('button', { name: 'Website' }).closest('.workspace-nav-row') as HTMLElement;
  assert.equal(projectRow.classList.contains('selected'), true);
});

test('Recent offers more conversations while the server has more', () => {
  const onLoadMoreRecent = vi.fn();
  const view = renderSidebar(createList(), { recentHasMore: true, onLoadMoreRecent });
  fireEvent.click(view.getByRole('button', { name: 'Load more' }));
  assert.equal(onLoadMoreRecent.mock.calls.length, 1);
});

test('the chat directory is recognised by its path, not its name, and stays out of Projects', () => {
  const view = renderSidebar();
  assert.equal(view.queryByRole('button', { name: 'Renamed chat folder' }), null);
  assert.equal(view.queryByRole('button', { name: 'Website' }), null);
  assert.ok(view.getByRole('button', { name: 'Hello' }), 'its conversation is listed under Chats');
  assert.equal(view.queryByRole('heading', { name: 'Projects' }), null);
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.ok(view.getByRole('button', { name: 'Website' }));
  assert.equal(view.queryByRole('button', { name: 'Hello' }), null);
  assert.equal(view.queryByRole('heading', { name: 'Chats' }), null);
});

test('shared Pinned and Recent entries select the owning conversation and switch mode in both directions', () => {
  writeUserPreference('workspaceSessions', { chatSessionIds: [], pinnedSessionIds: ['chat-1', 'session-1'] });
  const list = createList();
  const view = renderSidebar(list, { recent: [
    { sessionId: 'chat-1', sessionTitle: 'Recent chat', projectId: CHAT_PROJECT.projectId, provider: 'claude' },
    { sessionId: 'session-1', sessionTitle: 'Recent code', projectId: PROJECT.projectId, provider: 'claude' },
  ] });
  const select = list.onSessionSelect as ReturnType<typeof vi.fn>;
  const pinned = view.getByRole('heading', { name: 'Pinned' }).parentElement!;
  fireEvent.click(within(pinned).getByRole('button', { name: 'Fix the build' }));
  assert.equal(view.getByRole('tab', { name: 'Project' }).getAttribute('aria-selected'), 'true');
  assert.equal(select.mock.calls.at(-1)?.[0].id, 'session-1');
  fireEvent.click(within(pinned).getByRole('button', { name: 'Hello' }));
  assert.equal(view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected'), 'true');
  assert.equal(select.mock.calls.at(-1)?.[0].id, 'chat-1');
  fireEvent.click(view.getByRole('button', { name: 'Recent code' }));
  assert.equal(view.getByRole('tab', { name: 'Project' }).getAttribute('aria-selected'), 'true');
  fireEvent.click(view.getByRole('button', { name: 'Recent chat' }));
  assert.equal(view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected'), 'true');
  assert.equal(select.mock.calls.at(-1)?.[1], CHAT_PROJECT.projectId);
  assert.ok(view.getByRole('button', { name: 'Recent code' }), 'Recent remains shared');
  assert.ok(within(pinned).getByRole('button', { name: 'Fix the build' }), 'Pinned remains shared');
});

test('a shared project pin opens its latest Code conversation, while its chevron only expands the tree', () => {
  const list = createList({ isProjectStarred: (id) => id === PROJECT.projectId });
  const view = renderSidebar(list);
  const pinned = view.getByRole('heading', { name: 'Pinned' }).parentElement!;
  fireEvent.click(within(pinned).getByRole('button', { name: 'Hide project conversations' }));
  assert.equal(view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected'), 'true');
  assert.equal((list.onToggleProject as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  fireEvent.click(within(pinned).getByRole('button', { name: 'Website' }));
  assert.equal(view.getByRole('tab', { name: 'Project' }).getAttribute('aria-selected'), 'true');
  const select = list.onSessionSelect as ReturnType<typeof vi.fn>;
  assert.equal(select.mock.calls.at(-1)?.[0].id, 'session-1');
});

test('the sidebar search no longer offers archived conversations or their delete actions', () => {
  const archived = { sessionId: 'old-1', sessionTitle: 'Old idea' } as ArchivedSessionListItem;
  const onDeleteArchivedSession = vi.fn();
  const view = renderSidebar(createList(), { searchMode: 'archived', archivedSessions: [archived], onDeleteArchivedSession });

  fireEvent.click(view.getByRole('button', { name: 'Search' }));
  assert.equal(view.queryByText('Old idea'), null);
  assert.equal(view.queryByRole('button', { name: 'Delete…' }), null);
  assert.equal(view.queryByRole('tab', { name: 'Archived' }), null);
  assert.equal(onDeleteArchivedSession.mock.calls.length, 0);
});

test('empty groups have no heading or placeholder in either mode, including while loading', () => {
  for (const isLoading of [false, true]) {
    const view = renderSidebar(createList({ projects: [], filteredProjects: [], isLoading }));
    for (const mode of ['Chat', 'Project']) {
      fireEvent.click(view.getByRole('tab', { name: mode }));
      for (const heading of ['Pinned', 'Projects', 'Chats', 'Recent']) {
        assert.equal(view.queryByRole('heading', { name: heading }) === null, true, `${mode}: ${heading}`);
      }
      assert.equal(view.container.querySelector('.workspace-section-empty') === null, true);
    }
    view.unmount();
  }

  // Existing conversations and projects still show their respective groups.
  const filled = renderSidebar();
  assert.ok(filled.getByRole('heading', { name: 'Chats' }));
  assert.equal(filled.queryByRole('heading', { name: 'Pinned' }) === null, true);
  assert.equal(filled.queryByRole('heading', { name: 'Recent' }) === null, true);
  fireEvent.click(filled.getByRole('tab', { name: 'Project' }));
  assert.ok(filled.getByRole('heading', { name: 'Projects' }));
  filled.unmount();

  // A project listed under Pinned must not leave an empty Projects heading behind.
  const pinned = renderSidebar(createList({ isProjectStarred: () => true }));
  fireEvent.click(pinned.getByRole('tab', { name: 'Project' }));
  assert.ok(pinned.getByRole('heading', { name: 'Pinned' }));
  assert.equal(pinned.queryByRole('heading', { name: 'Projects' }) === null, true);
});

test('a conversation search never filters the project tree behind its dialog', () => {
  const onSearch = vi.fn();
  const view = renderSidebar(createList({ filteredProjects: [] }), { searchFilter: 'hello', onSearch });
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.ok(view.getByRole('heading', { name: 'Projects' }));
  assert.ok(view.getByRole('button', { name: 'Website' }));
  fireEvent.click(view.getByRole('button', { name: 'Fix the build' }));
  assert.equal(onSearch.mock.calls.at(-1)?.[0], '');
  assert.ok(view.getByRole('heading', { name: 'Projects' }));
});

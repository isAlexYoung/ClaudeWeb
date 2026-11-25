import assert from 'node:assert/strict';

import { fireEvent, render, within } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { WorkspaceExperienceProvider } from '@/shared/context/WorkspaceExperienceContext';
import { readUserPreference, resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type * as ArtefactsModule from '@/modules/artefacts';
import type { ArchivedSessionListItem, Project, ProjectSession, RecentConversationListItem, SidebarProjectListProps } from '@/shared/types';
import IntegratedSidebar from '@/modules/sidebar/IntegratedSidebar';
import { normalizeConversationPrefs, resetSessionViewsCache } from '@/modules/sidebar/conversationView';

vi.mock('@/shared/api', () => ({
  api: {
    sessionDetails: vi.fn(async () => ({ ok: false })),
    deleteSession: vi.fn(async () => ({ ok: true })),
    deleteProject: vi.fn(async () => ({ ok: true })),
    restoreSession: vi.fn(async () => ({ ok: true })),
    assets: {
      projectFiles: vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })),
    },
  },
  readApiJson: async (response: Response) => response.json(),
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { username: 'alex' }, logout: () => {} }) }));
// Conversations started by a scheduled task or owned by an artefact.
const scheduled = vi.hoisted(() => ({ ids: new Set<string>() }));
const artefactSessions = vi.hoisted(() => ({ kinds: new Map<string, string>() }));
vi.mock('@/modules/scheduled-tasks', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/modules/scheduled-tasks/ScheduledTaskMenu')),
  useScheduledTaskSessionIds: () => scheduled.ids,
}));
vi.mock('@/modules/artefacts', async () => ({
  artefactKind: (await vi.importActual<Pick<typeof ArtefactsModule, 'artefactKind'>>('@/modules/artefacts/artefactKinds')).artefactKind,
  useArtefactKindsBySession: () => artefactSessions.kinds,
}));

/** A Recents row as the server returns it (already narrowed to the current mode). */
const recentRow = (sessionId: string, sessionTitle: string, fields: Partial<RecentConversationListItem> = {}): RecentConversationListItem => ({
  sessionId,
  sessionTitle,
  projectId: CHAT_PROJECT_ID,
  provider: 'claude',
  projectDisplayName: 'Chat',
  lastActivity: null,
  ...fields,
});
const CHAT_PROJECT_ID = 'chat-project';
const conversationPrefs = () => normalizeConversationPrefs(readUserPreference('sidebarConversations', null));

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

const sidebarTree = (list = createList(), props: Record<string, unknown> = {}) => (
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
  </WorkspaceExperienceProvider>
);

const renderSidebar = (list = createList(), props: Record<string, unknown> = {}) => render(sidebarTree(list, props));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  scheduled.ids = new Set();
  artefactSessions.kinds = new Map();
  resetUserPreferences();
  localStorage.clear();
  resetSessionViewsCache();
  // chat-1 was started from New Chat, so it belongs to the Chats section.
  writeUserPreference('workspaceSessions', { chatSessionIds: ['chat-1'], pinnedSessionIds: [] });
});

test.each([false, true])('the sidebar logo opens the source repository (collapsed=%s)', (collapsed) => {
  const view = renderSidebar(createList(), { collapsed });
  const link = view.getByRole('link', { name: 'ClaudeWeb GitHub' });
  assert.equal(link.getAttribute('href'), 'https://github.com/isAlexYoung/ClaudeWeb');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  const logo = within(link).getByRole('img', { name: 'ClaudeWeb' });
  assert.equal(logo.getAttribute('width'), '24');
  assert.equal(logo.getAttribute('height'), '24');
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

test('Plugins opens a main-area page without opening Settings in expanded and collapsed navigation', () => {
  for (const collapsed of [false, true]) {
    const onSettings = vi.fn();
    const onNavigatePage = vi.fn();
    const view = renderSidebar(createList(), { collapsed, onSettings, onNavigatePage });
    const plugins = view.getByRole('button', { name: 'Plugins' });
    fireEvent.click(plugins);
    assert.equal(plugins.getAttribute('aria-pressed'), 'true');
    assert.equal(onSettings.mock.calls.length, 0);
    fireEvent.click(plugins);
    assert.equal(onNavigatePage.mock.calls.length, 2, 'reselecting the current page still closes a mobile drawer');
    const tasks = view.getByRole('button', { name: 'Scheduled tasks' });
    fireEvent.click(tasks);
    assert.equal(plugins.getAttribute('aria-pressed'), 'false');
    assert.equal(tasks.getAttribute('aria-pressed'), 'true');
    fireEvent.click(plugins);
    fireEvent.click(view.getByRole('button', { name: 'New chat' }));
    assert.equal(plugins.getAttribute('aria-pressed'), 'false');
    view.unmount();
  }
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

test('Scheduled tasks sits under New chat, Search and Artefacts and marks the conversations a task started', () => {
  scheduled.ids = new Set(['session-1']);
  const view = renderSidebar(createList(), { recent: [recentRow('chat-1', 'Hello')] });
  const entry = view.getByRole('button', { name: 'Scheduled tasks' });
  const newChat = view.getByRole('button', { name: 'New chat' });
  const search = view.getByRole('button', { name: /^Search$/ });
  const artefacts = view.getByRole('button', { name: 'Artefacts' });
  assert.equal(newChat.nextElementSibling, search);
  assert.equal(search.nextElementSibling, artefacts);
  assert.equal(artefacts.nextElementSibling, entry);
  assert.equal(entry.getAttribute('aria-pressed'), 'false');
  fireEvent.click(entry);
  assert.equal(entry.getAttribute('aria-pressed'), 'true');

  assert.equal(view.getByRole('button', { name: 'Hello' }).getAttribute('data-scheduled'), null);
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.equal(view.getByRole('button', { name: 'Fix the build' }).getAttribute('data-scheduled'), 'true');
});

test('Artefacts and Scheduled tasks show only in Chat, expanded and collapsed, and artefact chats name their kind at the end of the row', () => {
  artefactSessions.kinds = new Map([['chat-1', 'sheet']]);
  const list = createList();
  const props = { recent: [recentRow('chat-1', 'Hello'), recentRow('chat-2', 'Plain chat')] };
  const view = renderSidebar(list, props);
  const shown = (name: string) => view.queryByRole('button', { name }) !== null;
  const artefacts = view.getByRole('button', { name: 'Artefacts' });
  fireEvent.click(artefacts);
  assert.equal(artefacts.getAttribute('aria-pressed'), 'true');
  assert.equal(shown('Scheduled tasks'), true);
  const artefactRow = view.getByRole('button', { name: /^Hello/ });
  assert.equal(artefactRow.getAttribute('data-artefact'), 'true');
  // No leading icon: the title comes first and the kind icon last.
  assert.equal(artefactRow.firstElementChild?.tagName, 'SPAN');
  assert.ok(artefactRow.lastElementChild?.classList.contains('workspace-row-kind'));
  assert.equal(view.getByRole('button', { name: 'Plain chat' }).querySelector('svg'), null);
  // The collapsed rail has no mode tabs; it follows the mode chosen while expanded.
  view.rerender(sidebarTree(list, { ...props, collapsed: true }));
  assert.equal(shown('Scheduled tasks'), true);
  assert.equal(shown('Artefacts'), true);

  view.rerender(sidebarTree(list));
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.equal(shown('Scheduled tasks'), false);
  assert.equal(shown('Artefacts'), false);
  view.rerender(sidebarTree(list, { collapsed: true }));
  assert.equal(shown('Scheduled tasks'), false);
  assert.equal(shown('Artefacts'), false);

  view.rerender(sidebarTree(list));
  fireEvent.click(view.getByRole('tab', { name: 'Chat' }));
  assert.equal(shown('Scheduled tasks'), true);
  assert.equal(shown('Artefacts'), true);
});

test('legacy Chat-directory conversations stay out of Code, even without a saved mode classification', () => {
  const legacy = {
    ...CHAT_PROJECT,
    sessions: [{ id: 'chat-1', summary: 'Hello', __provider: 'claude' }, { id: 'old-1', summary: 'Old project chat', __provider: 'claude' }],
  } as unknown as Project;
  const view = renderSidebar(createList({ projects: [PROJECT, legacy], filteredProjects: [PROJECT, legacy], selectedProject: legacy }));
  assert.equal(view.queryByRole('button', { name: 'Renamed chat folder' }), null);
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
  assert.equal(view.queryByRole('heading', { name: 'Projects' }), null);
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.ok(view.getByRole('button', { name: 'Website' }));
  assert.equal(view.queryByRole('button', { name: 'Hello' }), null);
  assert.equal(view.queryByRole('heading', { name: 'Chats' }), null);
});

test('Chat and Code each pin only their own conversations, and a pin opens its conversation', () => {
  writeUserPreference('workspaceSessions', { chatSessionIds: [], pinnedSessionIds: ['chat-1', 'session-1'] });
  const list = createList();
  const view = renderSidebar(list, { recent: [recentRow('chat-1', 'Recent chat')] });
  const select = list.onSessionSelect as ReturnType<typeof vi.fn>;
  const pinned = () => view.getByRole('heading', { name: 'Pinned' }).parentElement!;
  assert.ok(within(pinned()).getByRole('button', { name: 'Hello' }));
  assert.equal(within(pinned()).queryByRole('button', { name: 'Fix the build' }), null);
  fireEvent.click(within(pinned()).getByRole('button', { name: 'Hello' }));
  assert.equal(select.mock.calls.at(-1)?.[0].id, 'chat-1');
  assert.equal(select.mock.calls.at(-1)?.[1], CHAT_PROJECT.projectId);

  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.ok(within(pinned()).getByRole('button', { name: 'Fix the build' }));
  assert.equal(within(pinned()).queryByRole('button', { name: 'Hello' }), null);
  fireEvent.click(within(pinned()).getByRole('button', { name: 'Fix the build' }));
  assert.equal(select.mock.calls.at(-1)?.[0].id, 'session-1');
});

test('a project pin shows only in Code, opens its latest conversation, while its chevron only expands the tree', () => {
  const list = createList({ isProjectStarred: (id) => id === PROJECT.projectId });
  const view = renderSidebar(list);
  assert.equal(view.queryByRole('heading', { name: 'Pinned' }), null, 'Chat does not list projects');
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  const pinned = view.getByRole('heading', { name: 'Pinned' }).parentElement!;
  fireEvent.click(within(pinned).getByRole('button', { name: 'Hide project conversations' }));
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

  // Chat no longer has a Chats list: its conversations are in Recents, whose header holds the menu.
  const filled = renderSidebar();
  assert.equal(filled.queryByRole('heading', { name: 'Chats' }), null);
  assert.equal(filled.queryByRole('heading', { name: 'Pinned' }) === null, true);
  assert.equal(filled.queryByRole('button', { name: 'Hello' }), null);
  assert.ok(filled.getByRole('button', { name: 'Filter and sort' }));
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

/** Opens a submenu of the open menu and returns its panel. */
const openSubmenu = (view: ReturnType<typeof renderSidebar>, label: RegExp) => {
  fireEvent.click(view.getByRole('menuitem', { name: label }));
  const panels = document.querySelectorAll<HTMLElement>('.scheduled-task-submenu');
  return panels[panels.length - 1];
};

test('Chat lists only Recents, collapsible in one click, and its menu sets status, period, scheduled tasks, grouping and sort', () => {
  const view = renderSidebar(createList(), { recent: [recentRow('chat-1', 'Hello'), recentRow('chat-2', 'Budget')] });
  assert.equal(view.queryByRole('heading', { name: 'Chats' }), null);
  const recents = view.getByRole('region', { name: 'Recents' });
  assert.ok(within(recents).getByRole('button', { name: 'Hello' }));

  const toggle = within(recents).getByRole('button', { name: 'Recents' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(conversationPrefs().collapsed.chatRecent, true);
  fireEvent.click(toggle);

  fireEvent.click(view.getByRole('button', { name: 'Filter and sort' }));
  assert.match(view.getByRole('menuitem', { name: /^Status/ }).textContent ?? '', /Active/);
  fireEvent.click(within(openSubmenu(view, /^Status/)).getByRole('menuitemradio', { name: 'Archived' }));
  fireEvent.click(within(openSubmenu(view, /^Last activity/)).getByRole('menuitemradio', { name: '7 days' }));
  fireEvent.click(within(openSubmenu(view, /^Scheduled tasks/)).getByRole('menuitemradio', { name: 'Hidden' }));
  fireEvent.click(within(openSubmenu(view, /^Group by/)).getByRole('menuitemradio', { name: 'Date' }));
  fireEvent.click(within(openSubmenu(view, /^Sort by/)).getByRole('menuitemradio', { name: 'Name' }));
  assert.deepEqual(conversationPrefs().chat, { status: 'archived', sinceDays: 7, scheduled: 'hidden', groupBy: 'date', sort: 'name' });
  assert.match(view.getByRole('menuitem', { name: /^Status/ }).textContent ?? '', /Archived/);
  assert.equal(view.queryByRole('menuitem', { name: /^Owner/ }), null, 'Owner is not offered');
});

test('Recents group by date or status and gather or hide scheduled-task conversations', () => {
  const now = Date.now();
  writeUserPreference('sidebarConversations', { chat: { groupBy: 'date', scheduled: 'grouped' } });
  scheduled.ids = new Set(['task-run']);
  const recent = [
    recentRow('chat-1', 'Today chat', { lastActivity: new Date(now - 60_000).toISOString() }),
    recentRow('chat-2', 'Old chat', { lastActivity: new Date(now - 20 * 24 * 3600_000).toISOString(), isArchived: true }),
    recentRow('task-run', 'Daily report', { lastActivity: new Date(now - 60_000).toISOString() }),
  ];
  const view = renderSidebar(createList(), { recent });
  const headings = () => view.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
  assert.deepEqual(headings(), ['Today', 'Previous 30 days', 'Scheduled tasks']);

  writeUserPreference('sidebarConversations', { chat: { groupBy: 'status', scheduled: 'hidden' } });
  view.rerender(sidebarTree(createList(), { recent }));
  assert.deepEqual(headings(), ['Active', 'Archived']);
  assert.equal(view.queryByRole('button', { name: 'Daily report' }), null);
  // An archived conversation's menu restores it instead of archiving it.
  fireEvent.click(view.getByRole('button', { name: 'Options for Old chat' }));
  assert.ok(view.getByRole('menuitem', { name: 'Restore conversation' }));
  assert.equal(view.queryByRole('menuitem', { name: 'Archive conversation' }), null);
});

test('a new section takes conversations moved from the row menu, collapses, and can be renamed or deleted', () => {
  const view = renderSidebar(createList(), { recent: [recentRow('chat-1', 'Hello'), recentRow('chat-2', 'Budget')] });
  fireEvent.click(view.getByRole('button', { name: 'Filter and sort' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'New section' }));
  const dialog = view.getByRole('dialog', { name: 'New section' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Section name' }), { target: { value: ' aa ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

  const section = () => view.getByRole('region', { name: 'aa' });
  assert.ok(within(section()).getByText('Nothing here yet'));

  fireEvent.click(view.getByRole('button', { name: 'Options for Hello' }));
  fireEvent.click(within(openSubmenu(view, /^Move to section/)).getByRole('menuitemradio', { name: 'aa' }));
  assert.ok(within(section()).getByRole('button', { name: 'Hello' }));
  assert.equal(within(view.getByRole('region', { name: 'Recents' })).queryByRole('button', { name: 'Hello' }), null);
  assert.equal(conversationPrefs().sessionSections['chat-1'], conversationPrefs().sections[0].id);

  const toggle = within(section()).getByRole('button', { name: 'aa' });
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  fireEvent.click(toggle);

  fireEvent.click(view.getByRole('button', { name: 'Options for aa' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'Rename section' }));
  const rename = view.getByRole('dialog', { name: 'Rename section' });
  fireEvent.change(within(rename).getByRole('textbox', { name: 'Section name' }), { target: { value: 'Work' } });
  fireEvent.click(within(rename).getByRole('button', { name: 'Save' }));
  assert.ok(view.getByRole('region', { name: 'Work' }));

  fireEvent.click(view.getByRole('button', { name: 'Options for Work' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete section' }));
  assert.equal(view.queryByRole('region', { name: 'Work' }), null);
  assert.ok(within(view.getByRole('region', { name: 'Recents' })).getByRole('button', { name: 'Hello' }), 'its conversations return to Recents');
});

test('"New section…" in a row menu creates the section with that conversation in it', () => {
  const view = renderSidebar(createList(), { recent: [recentRow('chat-1', 'Hello')] });
  fireEvent.click(view.getByRole('button', { name: 'Options for Hello' }));
  fireEvent.click(within(openSubmenu(view, /^Move to section/)).getByRole('menuitem', { name: 'New section…' }));
  const dialog = view.getByRole('dialog', { name: 'New section' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Section name' }), { target: { value: 'Ideas' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
  assert.ok(within(view.getByRole('region', { name: 'Ideas' })).getByRole('button', { name: 'Hello' }));
});

test('Code has only the sort menu: last updated, date created or name, descending or ascending', () => {
  const view = renderSidebar(createList(), { recent: [recentRow('session-1', 'Fix the build', { projectId: PROJECT.projectId })] });
  fireEvent.click(view.getByRole('tab', { name: 'Project' }));
  assert.equal(view.queryByRole('button', { name: 'Filter and sort' }), null);
  fireEvent.click(view.getByRole('button', { name: 'Sort' }));
  assert.deepEqual(view.getAllByRole('menuitem').map((item) => item.textContent?.replace(/\s+/g, ' ').trim()), ['Sort byLast updated']);
  const sort = openSubmenu(view, /^Sort by/);
  assert.equal(within(sort).getByRole('menuitemradio', { name: 'Last updated' }).getAttribute('aria-checked'), 'true');
  assert.equal(within(sort).getByRole('menuitemradio', { name: 'Descending' }).getAttribute('aria-checked'), 'true');
  fireEvent.click(within(sort).getByRole('menuitemradio', { name: 'Name' }));
  fireEvent.click(within(sort).getByRole('menuitemradio', { name: 'Ascending' }));
  assert.deepEqual(conversationPrefs().code, { sort: 'name', order: 'asc' });
  // Code rows keep their hover tools and have no section menu.
  assert.equal(view.queryByRole('button', { name: 'Options for Fix the build' }), null);
});

test('a conversation active since it was last opened shows as unread until it is opened', () => {
  const later = new Date(Date.now() + 60_000).toISOString();
  const list = createList();
  const view = renderSidebar(list, { recent: [recentRow('chat-1', 'Hello', { lastActivity: later })] });
  assert.equal(view.getByRole('button', { name: 'Hello' }).getAttribute('data-unread'), 'true');
  view.rerender(sidebarTree(createList({ selectedSession: { id: 'chat-1', summary: 'Hello', __provider: 'claude' } as ProjectSession }), {
    recent: [recentRow('chat-1', 'Hello', { lastActivity: later })],
  }));
  assert.equal(view.getAllByRole('button', { name: 'Hello' })[0].getAttribute('data-unread'), null);
});

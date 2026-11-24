import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Files,
  Folder,
  FolderOpen,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plug,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SquarePen,
  Trash2,
} from 'lucide-react';

import { useScheduledTaskSessionIds } from '@/modules/scheduled-tasks';
import { api } from '@/shared/api';
import { CHAT_WORKSPACE_PATH } from '@/shared/constants';
import { getWorkspaceSessionMode } from '@/shared/utils';
import { useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { Dialog, DialogContent, DialogTitle, MotionSurface } from '@/shared/ui';
import type {
  ArchivedProjectListItem,
  ArchivedSessionListItem,
  ConversationSearchResults,
  Project,
  ProjectSession,
  RecentConversationListItem,
  SettingsMainTab,
  SidebarProjectListProps,
  SidebarSearchMode,
} from '@/shared/types';
import WorkspaceAccount from '@/modules/sidebar/WorkspaceAccount';
import ProjectFilesPage from '@/modules/sidebar/ProjectFilesPage';

type IntegratedSidebarProps = {
  list: SidebarProjectListProps;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onSettings: (tab?: SettingsMainTab) => void;
  onNavigatePage?: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  onCreateProject: () => void;
  recent: RecentConversationListItem[];
  recentHasMore: boolean;
  isLoadingMoreRecent: boolean;
  onLoadMoreRecent: () => void;
  archivedProjects: ArchivedProjectListItem[];
  archivedSessions: ArchivedSessionListItem[];
  searchFilter: string;
  searchMode: SidebarSearchMode;
  onSearch: (value: string) => void;
  onSearchMode: (mode: SidebarSearchMode) => void;
  searchResults: ConversationSearchResults | null;
  isSearching: boolean;
  onRestoreProject: (id: string) => void;
  onRestoreSession: (id: string) => void;
  onDeleteArchivedSession: (session: ArchivedSessionListItem) => void;
  onProjectArchived?: (id: string) => void;
  onSessionArchived?: (id: string) => void;
};

type PinnedSessionRow = { session: ProjectSession; projectId: string };

const normalizePath = (value: string | undefined) => (value || '').replace(/\/+$/, '');

const isChatWorkspace = (project: Project) =>
  normalizePath(project.fullPath || project.path) === CHAT_WORKSPACE_PATH;

const sessionTitle = (session: ProjectSession) => (session.summary || session.title || '') as string;

/** Used by Sidebar to bind the approved navigation layout to the existing project and session APIs. */
export default function IntegratedSidebar(props: IntegratedSidebarProps) {
  const { list } = props;
  const { t } = useTranslation('sidebar');
  const experience = useWorkspaceExperience();
  // Search lives in one modal instead of the navigation tree; the backend query is unchanged.
  const [searchOpen, setSearchOpen] = useState(false);
  // A project has one contextual action menu open at a time.
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  // Operation failures stay visible instead of silently leaving rows in place.
  const [error, setError] = useState<string | null>(null);
  // The project whose File management page is open.
  const [filesProject, setFilesProject] = useState<{ name: string; path: string } | null>(null);
  // Pins can refer to an older session outside a project's loaded first page.
  const [extraPins, setExtraPins] = useState<Record<string, PinnedSessionRow | null>>({});
  // Remember the clicked occurrence when a conversation appears in several sections.
  const [selectedOccurrence, setSelectedOccurrence] = useState<{ sessionId: string; key: string } | null>(null);
  // Conversations a scheduled task started carry a clock instead of a speech bubble.
  const scheduledSessionIds = useScheduledTaskSessionIds();

  const allSessions = list.projects.flatMap((project) => list.getProjectSessions(project)
    .map((session) => ({ session, projectId: project.projectId })));
  const missingPins = experience.pinnedSessionIds
    .filter((id) => !allSessions.some((row) => row.session.id === id) && !(id in extraPins))
    .join('\n');

  useEffect(() => {
    if (!missingPins) return;
    let cancelled = false;
    void Promise.all(missingPins.split('\n').map(async (id) => {
      try {
        const response = await api.sessionDetails(id);
        if (!response.ok) return [id, null] as const;
        const { data } = await response.json() as {
          data?: { isArchived?: boolean; summary?: string; provider?: ProjectSession['__provider']; project?: { projectId: string; isArchived?: boolean } };
        };
        const usable = data?.project && !data.isArchived && !data.project.isArchived;
        return [id, usable
          ? { session: { id, summary: data.summary, __provider: data.provider }, projectId: data.project!.projectId }
          : null] as const;
      } catch {
        return [id, null] as const;
      }
    })).then((rows) => {
      if (!cancelled) setExtraPins((previous) => ({ ...previous, ...Object.fromEntries(rows) }));
    });
    return () => { cancelled = true; };
  }, [missingPins]);

  const { onSearchMode } = props;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        onSearchMode('conversations');
      }
      if (event.key === 'Escape') setMenuProjectId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onSearchMode]);

  useEffect(() => {
    if (!menuProjectId) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as Element).closest('[data-project-menu]')) setMenuProjectId(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menuProjectId]);

  const openSearch = () => {
    setSearchOpen(true);
    props.onSearchMode('conversations');
  };

  const openSession = (session: ProjectSession, projectId: string, occurrence?: string) => {
    setSelectedOccurrence(occurrence ? { sessionId: session.id, key: occurrence } : null);
    setSearchOpen(false);
    props.onSearch('');
    const project = list.projects.find((candidate) => candidate.projectId === projectId);
    experience.enterSession(session.id, getWorkspaceSessionMode(session.id, project, experience.chatSessionIds));
    list.onSessionSelect({ ...session, __provider: session.__provider || session.provider || 'claude' }, projectId);
  };

  const archive = async (kind: 'project' | 'session', id: string) => {
    setMenuProjectId(null);
    setError(null);
    try {
      const response = kind === 'project' ? await api.deleteProject(id) : await api.deleteSession(id);
      if (!response.ok) throw new Error(t('workspace.archiveFailed'));
      if (kind === 'project') props.onProjectArchived?.(id);
      else props.onSessionArchived?.(id);
      if (kind === 'session' && experience.pinnedSessionIds.includes(id)) experience.toggleSessionPin(id);
      props.onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('workspace.archiveFailed'));
    }
  };

  const renderSessionRow = (session: ProjectSession, projectId: string, section: string, nested = false) => {
    const title = sessionTitle(session) || t('workspace.untitled');
    const busy = list.activeSessions.has(session.id);
    const pinned = experience.pinnedSessionIds.includes(session.id);
    const occurrence = `${section}:${projectId}:${session.id}`;
    return (
      <div
        key={occurrence}
        className={`workspace-nav-row ${nested ? 'workspace-session-child' : ''} ${selectedRowKey === occurrence ? 'selected' : ''}`}
      >
        <button
          className="workspace-nav-main"
          title={title}
          data-scheduled={scheduledSessionIds.has(session.id) || undefined}
          onClick={() => openSession(session, projectId, occurrence)}
        >
          {!nested && (scheduledSessionIds.has(session.id) ? <Clock size={18} /> : <MessageCircle size={18} />)}
          <span>{title}</span>
          {busy && <i className="workspace-busy-dot" />}
          {list.attentionSessionIds.has(session.id) && <i className="workspace-attention-dot" />}
        </button>
        <div className="workspace-row-tools">
          <button
            className={pinned ? 'pinned' : ''}
            aria-label={pinned ? t('workspace.unpinSession') : t('workspace.pinSession')}
            title={pinned ? t('workspace.unpinSession') : t('workspace.pinSession')}
            onClick={() => experience.toggleSessionPin(session.id)}
          >
            <Pin size={14} />
          </button>
          <button
            aria-label={t('workspace.renameSession')}
            title={t('workspace.renameSession')}
            onClick={() => list.onStartEditingSession(projectId, session.id, sessionTitle(session))}
          >
            <Pencil size={14} />
          </button>
          <button
            aria-label={t('workspace.archiveSession')}
            title={t('workspace.archiveSession')}
            disabled={busy}
            onClick={() => void archive('session', session.id)}
          >
            <Archive size={14} />
          </button>
          <button
            aria-label={t('workspace.deleteSession')}
            title={t('workspace.deleteSession')}
            disabled={busy}
            // Opens the existing confirmation, which offers archiving or deleting for good.
            onClick={() => list.onDeleteSession(session.id, title)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  const renderProjectTree = (project: Project, pinned = false) => {
    const expanded = list.isProjectExpanded(project.projectId);
    const sessions = list.getProjectSessions(project).filter((session) => getWorkspaceSessionMode(session.id, project, experience.chatSessionIds) === 'project');
    const name = project.displayName;
    return (
      <div className="workspace-project-tree" key={project.projectId}>
        {/* The chat working directory is selected for every New chat; only its open conversation is highlighted. */}
        <div className={`workspace-nav-row ${!list.selectedSession && list.selectedProject?.projectId === project.projectId && !isChatWorkspace(project) ? 'selected' : ''}`}>
          <button className="workspace-nav-main" aria-expanded={pinned ? undefined : expanded} onClick={() => {
            if (!pinned) { list.onToggleProject(project.projectId); return; }
            // Shared project pins open their latest conversation; the separate chevron still expands the tree.
            if (sessions[0]) openSession(sessions[0], project.projectId);
            else { experience.enterProject(); list.onNewSession(project); }
          }}>
            {expanded ? <FolderOpen size={18} /> : <Folder size={18} />}
            <span>{name}</span>
          </button>
          <div className="workspace-row-tools" data-project-menu>
            <button
              aria-label={t('workspace.projectActions', { name })}
              aria-haspopup="menu"
              aria-expanded={menuProjectId === project.projectId}
              onClick={() => setMenuProjectId(menuProjectId === project.projectId ? null : project.projectId)}
            >
              <MoreHorizontal size={16} />
            </button>
            <button
              title={t('workspace.newProjectSession', { name })}
              aria-label={t('workspace.newProjectSession', { name })}
              onClick={() => list.onNewSession(project)}
            >
              <SquarePen size={15} />
            </button>
            <MotionSurface open={menuProjectId === project.projectId} role="menu" className="workspace-project-menu">
                <button role="menuitem" onClick={() => { list.onToggleStarProject(project.projectId); setMenuProjectId(null); }}>
                  <Pin size={15} />
                  {list.isProjectStarred(project.projectId) ? t('workspace.unpinProject') : t('workspace.pinProject')}
                </button>
                <button role="menuitem" onClick={() => { list.onStartEditingProject(project); setMenuProjectId(null); }}>
                  <Pencil size={15} />
                  {t('workspace.renameProject')}
                </button>
                <button role="menuitem" onClick={() => {
                  setFilesProject({ name, path: project.fullPath || project.path || '' });
                  setMenuProjectId(null);
                }}>
                  <Files size={15} />
                  {t('workspace.fileManagement')}
                </button>
                <button role="menuitem" onClick={() => { list.onDeleteProject(project); setMenuProjectId(null); }}>
                  <Trash2 size={15} />
                  {t('workspace.deleteProject')}
                </button>
                <button role="menuitem" onClick={() => void archive('project', project.projectId)}>
                  <Archive size={15} />
                  {t('workspace.archiveProject')}
                </button>
            </MotionSurface>
          </div>
          <button
            className="workspace-disclosure"
            aria-expanded={expanded}
            aria-label={expanded ? t('workspace.collapseProject') : t('workspace.expandProject')}
            onClick={() => list.onToggleProject(project.projectId)}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>
        <MotionSurface open={expanded} kind="disclosure">
          <div className="workspace-project-sessions">
            {sessions.map((session) => renderSessionRow(session, project.projectId, 'project', true))}
            {!sessions.length && (
              <button className="workspace-empty-project" onClick={() => list.onNewSession(project)}>
                {t('workspace.emptyProject')}
              </button>
            )}
            {project.sessionMeta?.hasMore && (
              <button className="workspace-empty-project" onClick={() => list.onLoadMoreSessions(project.projectId)}>
                {t('workspace.loadMoreSessions')}
              </button>
            )}
          </div>
        </MotionSurface>
      </div>
    );
  };

  // The reserved Chat directory backs standalone conversations, including those created before mode preferences existed.
  const projects = list.projects.filter((project) => !isChatWorkspace(project));
  const pinnedProjects = projects.filter((project) => list.isProjectStarred(project.projectId));
  const unpinnedProjects = projects.filter((project) => !list.isProjectStarred(project.projectId));
  const chatProjectsWithMore = list.projects.filter((project) => isChatWorkspace(project) && project.sessionMeta?.hasMore);
  const pinnedRows = [
    ...allSessions,
    ...Object.values(extraPins).filter((row): row is PinnedSessionRow => row !== null
      && !allSessions.some((loaded) => loaded.session.id === row.session.id)
      && list.projects.some((project) => project.projectId === row.projectId)),
  ].filter(({ session }) => experience.pinnedSessionIds.includes(session.id));
  const chatRows = allSessions.filter(({ session, projectId }) => getWorkspaceSessionMode(session.id,
    list.projects.find((project) => project.projectId === projectId), experience.chatSessionIds) === 'chat'
    && !experience.pinnedSessionIds.includes(session.id));

  // Route-driven selections use the first visible occurrence until a row is clicked.
  const selectedId = list.selectedSession?.id;
  const occurrences = [
    ...pinnedRows.map(({ session, projectId }) => ({ session, key: `pinned:${projectId}:${session.id}` })),
    ...(experience.mode === 'project' ? projects : pinnedProjects)
      .filter((project) => list.isProjectExpanded(project.projectId))
      .flatMap((project) => list.getProjectSessions(project)
        .filter((session) => getWorkspaceSessionMode(session.id, project, experience.chatSessionIds) === 'project')
        .map((session) => ({ session, key: `project:${project.projectId}:${session.id}` }))),
    ...(experience.mode === 'chat' ? chatRows : []).map(({ session, projectId }) => ({ session, key: `chat:${projectId}:${session.id}` })),
    ...props.recent.map((session) => ({ session: { id: session.sessionId }, key: `recent:${session.projectId || ''}:${session.sessionId}` })),
  ].filter(({ session }) => session.id === selectedId);
  const selectedRowKey = occurrences.find(({ key }) => selectedOccurrence?.sessionId === selectedId && selectedOccurrence?.key === key)?.key
    ?? occurrences[0]?.key;

  if (props.collapsed) {
    return (
      <aside className="workspace-sidebar collapsed" aria-label={t('workspace.navLabel')}>
        <a className="workspace-sidebar-brand" href="https://github.com/isAlexYoung/ClaudeWeb" target="_blank" rel="noopener noreferrer" aria-label="ClaudeWeb GitHub">
          <img className="workspace-sidebar-logo" src={`${import.meta.env.BASE_URL}logo.svg`} width="24" height="24" alt="ClaudeWeb" />
        </a>
        <button className="workspace-icon-button" aria-label={t('workspace.expandSidebar')} onClick={props.onExpand}>
          <PanelLeftOpen size={19} />
        </button>
        <button className="workspace-icon-button" aria-label={t('workspace.newChat')} onClick={() => experience.openHome(experience.mode)}>
          <SquarePen size={19} />
        </button>
        <button className="workspace-icon-button" aria-label={t('workspace.search')} onClick={openSearch}>
          <Search size={19} />
        </button>
        <button
          className="workspace-icon-button"
          aria-label={t('scheduledTasks.title')}
          aria-pressed={experience.scheduledTasksOpen}
          onClick={() => { experience.openScheduledTasks(); props.onNavigatePage?.(); }}
        >
          <Clock size={19} />
        </button>
        <button className="workspace-icon-button" aria-label={t('settings:mainTabs.plugins')} aria-pressed={experience.pluginsOpen} onClick={() => { experience.openPlugins(); props.onNavigatePage?.(); }}>
          <Plug size={19} />
        </button>
        <button className="workspace-icon-button workspace-rail-settings" aria-label={t('workspace.settings')} onClick={() => props.onSettings()}>
          <SettingsIcon size={19} />
        </button>
        <SidebarSearchDialog {...props} open={searchOpen} onOpenChange={setSearchOpen} projects={projects} onOpenSession={openSession} />
        <RenameDialogs list={list} />
        <ProjectFilesPage project={filesProject} onClose={() => setFilesProject(null)} />
      </aside>
    );
  }

  return (
    <aside className="workspace-sidebar" aria-label={t('workspace.navLabel')}>
      <div className="workspace-sidebar-tools">
        <a className="workspace-sidebar-brand" href="https://github.com/isAlexYoung/ClaudeWeb" target="_blank" rel="noopener noreferrer" aria-label="ClaudeWeb GitHub">
          <img className="workspace-sidebar-logo" src={`${import.meta.env.BASE_URL}logo.svg`} width="24" height="24" alt="ClaudeWeb" />
        </a>
        <button className="workspace-icon-button" aria-label={t('workspace.collapseSidebar')} onClick={props.onCollapse}>
          <PanelLeftClose size={18} />
        </button>
        <button className="workspace-icon-button" aria-label={t('workspace.refresh')} title={t('workspace.refresh')} aria-busy={props.isRefreshing} disabled={props.isRefreshing} onClick={props.onRefresh}>
          <RefreshCw size={18} className={props.isRefreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />
        </button>
        <div className="workspace-mode-tabs" role="tablist" aria-label={t('workspace.modeTabs')}>
          <button role="tab" aria-label={t('workspace.modeChat')} aria-selected={experience.mode === 'chat'} onClick={() => experience.switchMode('chat')}>
            <MessagesSquare size={19} />
          </button>
          <button role="tab" aria-label={t('workspace.modeProject')} aria-selected={experience.mode === 'project'} onClick={() => experience.switchMode('project')}>
            <Code2 size={19} />
          </button>
        </div>
      </div>
      <button className="workspace-new-chat" onClick={() => experience.openHome(experience.mode)}>
        <SquarePen size={18} />
        {t('workspace.newChat')}
      </button>
      <button className="workspace-new-chat" onClick={openSearch}>
        <Search size={18} />
        {t('workspace.search')}
      </button>
      <button
        className={`workspace-new-chat workspace-scheduled-entry ${experience.scheduledTasksOpen ? 'selected' : ''}`}
        aria-pressed={experience.scheduledTasksOpen}
        onClick={() => { experience.openScheduledTasks(); props.onNavigatePage?.(); }}
      >
        <Clock size={18} />
        {t('scheduledTasks.title')}
      </button>
      <button
        className={`workspace-new-chat workspace-scheduled-entry ${experience.pluginsOpen ? 'selected' : ''}`}
        aria-pressed={experience.pluginsOpen}
        onClick={() => { experience.openPlugins(); props.onNavigatePage?.(); }}
      >
        <Plug size={18} />
        {t('settings:mainTabs.plugins')}
      </button>
      <nav className="workspace-navigation">
        {error && <p role="alert">{error}</p>}
        {(pinnedProjects.length > 0 || pinnedRows.length > 0) && <section>
          <h2>{t('workspace.sections.pinned')}</h2>
          {pinnedProjects.map((project) => renderProjectTree(project, true))}
          {pinnedRows.map(({ session, projectId }) => renderSessionRow(session, projectId, 'pinned'))}
        </section>}
        {experience.mode === 'project' && unpinnedProjects.length > 0 && <section>
          <h2>{t('workspace.sections.projects')}</h2>
          {unpinnedProjects.map((project) => renderProjectTree(project))}
        </section>}
        {experience.mode === 'chat' && (chatRows.length > 0 || chatProjectsWithMore.length > 0) && <section>
          <h2>{t('workspace.sections.chats')}</h2>
          {chatRows.map(({ session, projectId }) => renderSessionRow(session, projectId, 'chat'))}
          {chatProjectsWithMore.map((project) => (
            <button
              key={project.projectId}
              className="workspace-empty-project"
              disabled={list.loadingMoreProjects.has(project.projectId)}
              onClick={() => list.onLoadMoreSessions(project.projectId)}
            >
              {t('workspace.loadMoreChats')}
            </button>
          ))}
        </section>}
        {(props.recent.length > 0 || props.recentHasMore) && <section>
          <h2>{t('workspace.sections.recent')}</h2>
          {props.recent.map((session) => renderSessionRow(
            { id: session.sessionId, summary: session.sessionTitle, __provider: session.provider as ProjectSession['__provider'] },
            session.projectId || '',
            'recent',
          ))}
          {props.recentHasMore && (
            <button className="workspace-empty-project" disabled={props.isLoadingMoreRecent} onClick={props.onLoadMoreRecent}>
              {t('workspace.loadMoreRecent')}
            </button>
          )}
        </section>}
      </nav>
      <WorkspaceAccount onSettings={props.onSettings} />
      <SidebarSearchDialog {...props} open={searchOpen} onOpenChange={setSearchOpen} projects={list.filteredProjects.filter(project => !isChatWorkspace(project))} onOpenSession={openSession} />
      <RenameDialogs list={list} />
      <ProjectFilesPage project={filesProject} onClose={() => setFilesProject(null)} />
    </aside>
  );
}

type SidebarSearchDialogProps = IntegratedSidebarProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  onOpenSession: (session: ProjectSession, projectId: string) => void;
};

function SidebarSearchDialog({ open, onOpenChange, projects, onOpenSession, ...props }: SidebarSearchDialogProps) {
  const { t } = useTranslation('sidebar');
  const titleResults = props.searchResults?.titleResults || [];
  const scopes = [
    ['projects', t('workspace.searchDialog.scopeProjects')],
    ['conversations', t('workspace.searchDialog.scopeChats')],
    // Archived sessions are not part of the sidebar: they live in Settings > Tasks and sessions.
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value) props.onSearch(''); }}>
      <DialogContent className="workspace-search-dialog">
        <DialogTitle>{t('workspace.searchDialog.title')}</DialogTitle>
        <div className="workspace-search-input">
          <Search size={19} />
          <input
            autoFocus
            aria-label={t('workspace.searchDialog.title')}
            placeholder={t('workspace.searchDialog.placeholder')}
            value={props.searchFilter}
            onChange={(event) => props.onSearch(event.target.value)}
          />
        </div>
        <div className="workspace-search-scopes">
          {scopes.map(([mode, label]) => (
            <button key={mode} aria-pressed={props.searchMode === mode} onClick={() => props.onSearchMode(mode)}>{label}</button>
          ))}
        </div>
        <div className="workspace-search-results">
          {props.searchMode === 'projects' && projects.map((project) => (
            <button key={project.projectId} onClick={() => { onOpenChange(false); props.list.onNewSession(project); }}>
              <Folder size={17} />
              <span>{project.displayName}<small>{project.fullPath}</small></span>
            </button>
          ))}
          {props.searchMode === 'conversations' && (
            <>
              {props.isSearching && <p role="status">{t('workspace.searchDialog.searching')}</p>}
              {(props.searchFilter.trim().length >= 2 ? titleResults : props.recent).map((session) => (
                <button
                  key={session.sessionId}
                  onClick={() => onOpenSession(
                    { id: session.sessionId, summary: session.sessionTitle, __provider: session.provider as ProjectSession['__provider'] },
                    session.projectId || '',
                  )}
                >
                  <MessageCircle size={17} />
                  <span>{session.sessionTitle}<small>{session.projectDisplayName}</small></span>
                </button>
              ))}
              {props.searchResults?.results.map((project) => project.sessions.flatMap((session) => session.matches.map((match, index) => (
                <button
                  key={`content-${session.sessionId}-${index}`}
                  onClick={() => onOpenSession(
                    { id: session.sessionId, summary: session.sessionSummary, __provider: (session.provider || 'claude') as ProjectSession['__provider'],
                      __searchQuery: props.searchFilter, __searchTargetSnippet: match.snippet, __searchTargetTimestamp: match.timestamp,
                      __searchTargetMessageUuid: match.messageUuid, __searchTargetRole: match.role,
                      __searchTargetRequest: crypto.randomUUID() },
                    project.projectId || '',
                  )}
                >
                  <Search size={17} />
                  <span>{session.sessionSummary}<small>{match.snippet}</small></span>
                </button>
              ))))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Project and session rename share the sidebar's single active rename. */
function RenameDialogs({ list }: { list: SidebarProjectListProps }) {
  const { t } = useTranslation('sidebar');
  const rename = list.activeRename;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (rename?.target === 'project') list.onSaveProjectName(rename.id, rename.draft);
    if (rename?.target === 'session') list.onSaveEditingSession(rename.projectId, rename.id, rename.draft, 'claude');
  };

  const isProject = rename?.target === 'project';
  return (
    <Dialog
      open={Boolean(rename)}
      onOpenChange={(value) => {
        if (value) return;
        if (isProject) list.onCancelEditingProject();
        else list.onCancelEditingSession();
      }}
    >
      <DialogContent className="workspace-account-dialog">
        <DialogTitle>{isProject ? t('workspace.renameProjectTitle') : t('workspace.renameSessionTitle')}</DialogTitle>
        <form onSubmit={submit}>
          <input
            autoFocus
            aria-label={isProject ? t('workspace.projectName') : t('workspace.sessionName')}
            value={rename?.draft || ''}
            onChange={(event) => list.onRenameDraftChange(event.target.value)}
          />
          <button className="workspace-primary-button" type="submit">{t('workspace.saveName')}</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

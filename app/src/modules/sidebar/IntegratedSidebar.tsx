import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
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
  ListFilter,
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
  Shapes,
  SquarePen,
  Trash2,
} from 'lucide-react';

import { artefactKind, useArtefactKindsBySession } from '@/modules/artefacts';
import {
  ScheduledTaskMenu,
  ScheduledTaskMenuDivider,
  ScheduledTaskMenuItem,
  ScheduledTaskSubmenu,
  useScheduledTaskSessionIds,
} from '@/modules/scheduled-tasks';
import {
  addSection,
  groupRecents,
  isConversationUnread,
  markSessionViewed,
  moveToSection,
  removeSection,
  renameSection,
  useSessionViews,
  useSidebarConversationPrefs,
} from '@/modules/sidebar/conversationView';
import type { ChatRecentsFilter, CodeRecentsFilter, SidebarConversationPrefs } from '@/modules/sidebar/conversationView';
import { useModeSwapMotion } from '@/modules/sidebar/hooks/useModeSwapMotion';
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
  /** Reloads Recents from the first page (after an archive, a restore, ...). */
  onReloadRecent?: () => void;
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

/** Where the row menu's "New section…" was chosen from, so the new section can take that conversation. */
type SectionDialogState = { mode: 'create'; moveSessionId: string | null } | { mode: 'rename'; id: string };

const normalizePath = (value: string | undefined) => (value || '').replace(/\/+$/, '');

const isChatWorkspace = (project: Project) =>
  normalizePath(project.fullPath || project.path) === CHAT_WORKSPACE_PATH;

const sessionTitle = (session: ProjectSession) => (session.summary || session.title || '') as string;

/** Used by Sidebar to bind the approved navigation layout to the existing project and session APIs. */
export default function IntegratedSidebar(props: IntegratedSidebarProps) {
  const { list } = props;
  const { t } = useTranslation('sidebar');
  const experience = useWorkspaceExperience();
  // Artefacts and Scheduled tasks are Chat features: Code mode does not list them.
  const showChatPages = experience.mode === 'chat';
  const modeSwapRef = useModeSwapMotion(experience.mode);
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
  // Rows carry no leading icon; an artefact's conversation names its kind at the end of the row.
  const artefactKinds = useArtefactKindsBySession();
  const scheduledSessionIds = useScheduledTaskSessionIds();
  // Recents filters, the user's sections and what is collapsed; saved as a preference.
  const [conversationPrefs, updateConversationPrefs] = useSidebarConversationPrefs();
  const sessionViews = useSessionViews();
  const [sectionDialog, setSectionDialog] = useState<SectionDialogState | null>(null);
  const isChatMode = experience.mode === 'chat';

  // The open conversation counts as read when it is opened and again when it is left.
  const viewedSessionId = list.selectedSession?.id ?? null;
  useEffect(() => {
    if (!viewedSessionId) return undefined;
    markSessionViewed(viewedSessionId);
    return () => markSessionViewed(viewedSessionId);
  }, [viewedSessionId]);

  const allSessions = list.projects.flatMap((project) => list.getProjectSessions(project)
    .map((session) => ({ session, projectId: project.projectId })));
  // Pins and filed conversations can be older than anything loaded; they are looked up once by id.
  const sectionSessionIds = Object.keys(conversationPrefs.sessionSections);
  const missingPins = [...new Set([...experience.pinnedSessionIds, ...sectionSessionIds])]
    .filter((id) => !allSessions.some((row) => row.session.id === id)
      && !props.recent.some((row) => row.sessionId === id)
      && !(id in extraPins))
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
      props.onReloadRecent?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('workspace.archiveFailed'));
    }
  };

  // Recents can list archived conversations (Status: Archived or All); their menu restores them.
  const restore = async (id: string) => {
    setError(null);
    try {
      const response = await api.restoreSession(id);
      if (!response.ok) throw new Error(t('workspace.archiveFailed'));
      props.onRefresh();
      props.onReloadRecent?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('workspace.archiveFailed'));
    }
  };

  const updatePrefs = (change: (prefs: SidebarConversationPrefs) => SidebarConversationPrefs) => updateConversationPrefs(change);
  const setChatFilter = (change: Partial<ChatRecentsFilter>) => updatePrefs((prefs) => ({ ...prefs, chat: { ...prefs.chat, ...change } }));
  const setCodeFilter = (change: Partial<CodeRecentsFilter>) => updatePrefs((prefs) => ({ ...prefs, code: { ...prefs.code, ...change } }));

  /** Chat rows: the hover menu with pin, rename, sections, archive or restore, and delete. */
  const renderConversationMenu = (session: ProjectSession, projectId: string, title: string, busy: boolean, archived: boolean) => {
    const pinned = experience.pinnedSessionIds.includes(session.id);
    const currentSection = conversationPrefs.sessionSections[session.id] ?? null;
    return (
      <div className="workspace-row-tools workspace-row-menu">
        <ScheduledTaskMenu
          trigger={<MoreHorizontal size={16} />}
          ariaLabel={t('workspace.conversationActions', { name: title })}
          title={t('workspace.conversationActions', { name: title })}
          panelClassName="workspace-conversation-menu"
        >
          {(close) => (
            <>
              <ScheduledTaskMenuItem
                icon={<Pin size={15} />}
                label={pinned ? t('workspace.unpinSession') : t('workspace.pinSession')}
                onSelect={() => { close(); experience.toggleSessionPin(session.id); }}
              />
              <ScheduledTaskMenuItem
                icon={<Pencil size={15} />}
                label={t('workspace.renameSession')}
                onSelect={() => { close(); list.onStartEditingSession(projectId, session.id, sessionTitle(session)); }}
              />
              <ScheduledTaskSubmenu label={t('workspace.conversationSections.moveTo')}>
                {conversationPrefs.sections.map((section) => (
                  <ScheduledTaskMenuItem
                    key={section.id}
                    label={section.name}
                    selected={currentSection === section.id}
                    onSelect={() => { close(); updatePrefs((prefs) => moveToSection(prefs, session.id, section.id)); }}
                  />
                ))}
                {currentSection && (
                  <ScheduledTaskMenuItem
                    label={t('workspace.conversationSections.removeFrom')}
                    onSelect={() => { close(); updatePrefs((prefs) => moveToSection(prefs, session.id, null)); }}
                  />
                )}
                {(conversationPrefs.sections.length > 0 || currentSection) && <ScheduledTaskMenuDivider />}
                <ScheduledTaskMenuItem
                  label={t('workspace.conversationSections.newWithConversation')}
                  onSelect={() => { close(); setSectionDialog({ mode: 'create', moveSessionId: session.id }); }}
                />
              </ScheduledTaskSubmenu>
              <ScheduledTaskMenuDivider />
              {archived ? (
                <ScheduledTaskMenuItem
                  icon={<Archive size={15} />}
                  label={t('workspace.restoreSession')}
                  onSelect={() => { close(); void restore(session.id); }}
                />
              ) : (
                <ScheduledTaskMenuItem
                  icon={<Archive size={15} />}
                  label={t('workspace.archiveSession')}
                  onSelect={() => { close(); if (!busy) void archive('session', session.id); }}
                />
              )}
              <ScheduledTaskMenuItem
                icon={<Trash2 size={15} />}
                label={t('workspace.deleteSession')}
                danger
                onSelect={() => { close(); if (!busy) list.onDeleteSession(session.id, title); }}
              />
            </>
          )}
        </ScheduledTaskMenu>
      </div>
    );
  };

  const renderSessionRow = (
    session: ProjectSession,
    projectId: string,
    section: string,
    nested = false,
    row: { archived?: boolean; lastActivity?: string | null } = {},
  ) => {
    const title = sessionTitle(session) || t('workspace.untitled');
    const busy = list.activeSessions.has(session.id);
    const pinned = experience.pinnedSessionIds.includes(session.id);
    const occurrence = `${section}:${projectId}:${session.id}`;
    const kind = artefactKinds.get(session.id);
    const KindIcon = kind ? artefactKind(kind).icon : null;
    const unread = session.id !== viewedSessionId && (list.attentionSessionIds.has(session.id)
      || (row.lastActivity !== undefined && isConversationUnread({ sessionId: session.id, lastActivity: row.lastActivity }, sessionViews)));
    return (
      <div
        key={occurrence}
        className={`workspace-nav-row ${nested ? 'workspace-session-child' : ''} ${selectedRowKey === occurrence ? 'selected' : ''}`}
        data-archived={row.archived || undefined}
      >
        <button
          className="workspace-nav-main"
          title={title}
          data-artefact={kind ? true : undefined}
          data-scheduled={scheduledSessionIds.has(session.id) || undefined}
          data-unread={unread || undefined}
          onClick={() => openSession(session, projectId, occurrence)}
        >
          <span>{title}</span>
          {busy && <i className="workspace-busy-dot" />}
          {unread && <i className="workspace-attention-dot" />}
          {KindIcon && <KindIcon size={15} className="workspace-row-kind" aria-label={t(`artefacts.kinds.${kind}`)} />}
        </button>
        {isChatMode ? renderConversationMenu(session, projectId, title, busy, Boolean(row.archived)) : (
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
        )}
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
  // Chat and Code do not share conversations: Chat pins Chat conversations, Code pins projects and theirs.
  const pinnedProjects = isChatMode ? [] : projects.filter((project) => list.isProjectStarred(project.projectId));
  const unpinnedProjects = projects.filter((project) => !list.isProjectStarred(project.projectId));
  const modeOf = (sessionId: string, projectId: string) => getWorkspaceSessionMode(sessionId,
    list.projects.find((project) => project.projectId === projectId), experience.chatSessionIds);

  // Every conversation the sidebar can show by id (for pins and sections). Recents rows add their
  // last activity (for unread) and archive state.
  type KnownRow = PinnedSessionRow & { item?: RecentConversationListItem };
  const knownRows = new Map<string, KnownRow>();
  for (const row of allSessions) knownRows.set(row.session.id, row);
  for (const item of props.recent) {
    const loaded = knownRows.get(item.sessionId);
    knownRows.set(item.sessionId, loaded ? { ...loaded, item } : {
      session: { id: item.sessionId, summary: item.sessionTitle, __provider: item.provider as ProjectSession['__provider'] },
      projectId: item.projectId || '',
      item,
    });
  }
  for (const [id, row] of Object.entries(extraPins)) {
    if (row && !knownRows.has(id) && list.projects.some((project) => project.projectId === row.projectId)) knownRows.set(id, row);
  }
  const pinnedRows = experience.pinnedSessionIds
    .map((id) => knownRows.get(id))
    .filter((row): row is KnownRow => Boolean(row) && modeOf(row!.session.id, row!.projectId) === experience.mode);

  // Sections hold Chat conversations; a filed conversation leaves Recents.
  const sectionRows = (sectionId: string) => Object.entries(conversationPrefs.sessionSections)
    .filter(([, id]) => id === sectionId)
    .map(([sessionId]) => knownRows.get(sessionId))
    .filter((row): row is KnownRow => Boolean(row));
  const recentItems = isChatMode
    ? props.recent.filter((item) => !conversationPrefs.sessionSections[item.sessionId])
    : props.recent;
  const recentGroups = isChatMode
    ? groupRecents(recentItems, {
      groupBy: conversationPrefs.chat.groupBy,
      scheduled: conversationPrefs.chat.scheduled,
      scheduledIds: scheduledSessionIds,
      isUnread: (item) => item.sessionId !== viewedSessionId
        && (list.attentionSessionIds.has(item.sessionId) || isConversationUnread(item, sessionViews)),
    })
    : recentItems.length > 0 ? [{ key: 'all' as const, items: recentItems }] : [];
  const recentCollapsed = isChatMode ? conversationPrefs.collapsed.chatRecent : conversationPrefs.collapsed.codeRecent;

  // Route-driven selections use the first visible occurrence until a row is clicked.
  const selectedId = list.selectedSession?.id;
  const occurrences = [
    ...pinnedRows.map(({ session, projectId }) => ({ session, key: `pinned:${projectId}:${session.id}` })),
    ...(experience.mode === 'project' ? projects : pinnedProjects)
      .filter((project) => list.isProjectExpanded(project.projectId))
      .flatMap((project) => list.getProjectSessions(project)
        .filter((session) => getWorkspaceSessionMode(session.id, project, experience.chatSessionIds) === 'project')
        .map((session) => ({ session, key: `project:${project.projectId}:${session.id}` }))),
    ...(isChatMode ? conversationPrefs.sections : []).flatMap((section) => sectionRows(section.id)
      .map(({ session, projectId }) => ({ session, key: `section-${section.id}:${projectId}:${session.id}` }))),
    ...recentItems.map((session) => ({ session: { id: session.sessionId }, key: `recent:${session.projectId || ''}:${session.sessionId}` })),
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
        {showChatPages && (
          <button
            className="workspace-icon-button"
            aria-label={t('artefacts.title')}
            aria-pressed={experience.artefactsOpen}
            onClick={() => { experience.openArtefacts(); props.onNavigatePage?.(); }}
          >
            <Shapes size={19} />
          </button>
        )}
        {showChatPages && (
          <button
            className="workspace-icon-button"
            aria-label={t('scheduledTasks.title')}
            aria-pressed={experience.scheduledTasksOpen}
            onClick={() => { experience.openScheduledTasks(); props.onNavigatePage?.(); }}
          >
            <Clock size={19} />
          </button>
        )}
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
        <div className="workspace-mode-tabs" role="tablist" aria-label={t('workspace.modeTabs')} data-mode={experience.mode}>
          <button role="tab" aria-label={t('workspace.modeChat')} aria-selected={experience.mode === 'chat'} onClick={() => experience.switchMode('chat')}>
            <MessagesSquare size={19} />
          </button>
          <button role="tab" aria-label={t('workspace.modeProject')} aria-selected={experience.mode === 'project'} onClick={() => experience.switchMode('project')}>
            <Code2 size={19} />
          </button>
        </div>
      </div>
      <div ref={modeSwapRef} className="workspace-sidebar-body">
      <button className="workspace-new-chat" onClick={() => experience.openHome(experience.mode)}>
        <SquarePen size={18} />
        {t('workspace.newChat')}
      </button>
      <button className="workspace-new-chat" onClick={openSearch}>
        <Search size={18} />
        {t('workspace.search')}
      </button>
      {showChatPages && (
        <button
          className={`workspace-new-chat workspace-scheduled-entry ${experience.artefactsOpen ? 'selected' : ''}`}
          aria-pressed={experience.artefactsOpen}
          onClick={() => { experience.openArtefacts(); props.onNavigatePage?.(); }}
        >
          <Shapes size={18} />
          {t('artefacts.title')}
        </button>
      )}
      {showChatPages && (
        <button
          className={`workspace-new-chat workspace-scheduled-entry ${experience.scheduledTasksOpen ? 'selected' : ''}`}
          aria-pressed={experience.scheduledTasksOpen}
          onClick={() => { experience.openScheduledTasks(); props.onNavigatePage?.(); }}
        >
          <Clock size={18} />
          {t('scheduledTasks.title')}
        </button>
      )}
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
          {pinnedRows.map(({ session, projectId, item }) => renderSessionRow(session, projectId, 'pinned', false,
            { archived: item?.isArchived, lastActivity: item?.lastActivity }))}
        </section>}
        {!isChatMode && unpinnedProjects.length > 0 && <section>
          <h2>{t('workspace.sections.projects')}</h2>
          {unpinnedProjects.map((project) => renderProjectTree(project))}
        </section>}
        {isChatMode && conversationPrefs.sections.map((section) => {
          const rows = sectionRows(section.id);
          const collapsed = conversationPrefs.collapsed.sections[section.id] === true;
          return (
            <section key={section.id} className="workspace-conversation-section" aria-label={section.name}>
              <div className="workspace-recents-head">
                <button
                  className="workspace-recents-toggle"
                  aria-expanded={!collapsed}
                  title={t('workspace.conversationSections.toggle', { name: section.name })}
                  onClick={() => updatePrefs((prefs) => ({
                    ...prefs,
                    collapsed: { ...prefs.collapsed, sections: { ...prefs.collapsed.sections, [section.id]: !collapsed } },
                  }))}
                >
                  <span>{section.name}</span>
                  <ChevronDown size={13} />
                </button>
                <ScheduledTaskMenu
                  trigger={<MoreHorizontal size={15} />}
                  ariaLabel={t('workspace.conversationSections.actions', { name: section.name })}
                  title={t('workspace.conversationSections.actions', { name: section.name })}
                  triggerClassName="workspace-recents-action workspace-section-action"
                >
                  {(close) => (
                    <>
                      <ScheduledTaskMenuItem
                        icon={<Pencil size={15} />}
                        label={t('workspace.conversationSections.rename')}
                        onSelect={() => { close(); setSectionDialog({ mode: 'rename', id: section.id }); }}
                      />
                      <ScheduledTaskMenuItem
                        icon={<Trash2 size={15} />}
                        label={t('workspace.conversationSections.delete')}
                        danger
                        onSelect={() => { close(); updatePrefs((prefs) => removeSection(prefs, section.id)); }}
                      />
                    </>
                  )}
                </ScheduledTaskMenu>
              </div>
              <MotionSurface open={!collapsed} kind="disclosure">
                <div className="workspace-recents-list">
                  {rows.map(({ session, projectId, item }) => renderSessionRow(session, projectId, `section-${section.id}`, false,
                    { archived: item?.isArchived, lastActivity: item?.lastActivity }))}
                  {rows.length === 0 && <p className="workspace-recents-empty">{t('workspace.conversationSections.empty')}</p>}
                </div>
              </MotionSurface>
            </section>
          );
        })}
        <section className="workspace-recents" aria-label={t('workspace.sections.recent')}>
          <div className="workspace-recents-head">
            <button
              className="workspace-recents-toggle"
              aria-expanded={!recentCollapsed}
              title={t('workspace.recents.toggle')}
              onClick={() => updatePrefs((prefs) => ({
                ...prefs,
                collapsed: { ...prefs.collapsed, [isChatMode ? 'chatRecent' : 'codeRecent']: !recentCollapsed },
              }))}
            >
              <span>{t('workspace.sections.recent')}</span>
              <ChevronDown size={13} />
            </button>
            {isChatMode ? (
              <ChatRecentsMenu
                filter={conversationPrefs.chat}
                onChange={setChatFilter}
                onNewSection={() => setSectionDialog({ mode: 'create', moveSessionId: null })}
              />
            ) : (
              <CodeRecentsMenu filter={conversationPrefs.code} onChange={setCodeFilter} />
            )}
          </div>
          <MotionSurface open={!recentCollapsed} kind="disclosure">
            <div className="workspace-recents-list">
              {recentGroups.map((group) => (
                <div key={group.key} className="workspace-recents-group">
                  {group.key !== 'all' && <h3>{t(`workspace.recents.groups.${group.key}`)}</h3>}
                  {group.items.map((item) => renderSessionRow(
                    { id: item.sessionId, summary: item.sessionTitle, __provider: item.provider as ProjectSession['__provider'] },
                    item.projectId || '',
                    'recent',
                    false,
                    { archived: item.isArchived, lastActivity: item.lastActivity },
                  ))}
                </div>
              ))}
              {props.recentHasMore && (
                <button className="workspace-empty-project" disabled={props.isLoadingMoreRecent} onClick={props.onLoadMoreRecent}>
                  {t('workspace.loadMoreRecent')}
                </button>
              )}
            </div>
          </MotionSurface>
        </section>
      </nav>
      </div>
      <WorkspaceAccount onSettings={props.onSettings} />
      <SectionDialog
        state={sectionDialog}
        prefs={conversationPrefs}
        onClose={() => setSectionDialog(null)}
        onSubmit={(name) => {
          const dialog = sectionDialog;
          setSectionDialog(null);
          if (!dialog) return;
          if (dialog.mode === 'rename') updatePrefs((prefs) => renameSection(prefs, dialog.id, name));
          else updatePrefs((prefs) => addSection(prefs, { id: crypto.randomUUID(), name }, dialog.moveSessionId));
        }}
      />
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

/** A submenu row showing its current choice on the right: "Status    Active ›". */
function MenuChoice({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <span className="workspace-menu-choice">
      <span>{label}</span>
      <small>{value}</small>
    </span>
  );
}

const SINCE_DAYS: Array<{ value: ChatRecentsFilter['sinceDays']; key: string }> = [
  { value: 1, key: 'day1' },
  { value: 3, key: 'day3' },
  { value: 7, key: 'day7' },
  { value: 30, key: 'day30' },
  { value: null, key: 'allTime' },
];

/** Chat's Recents menu: status, period, scheduled tasks, grouping, sort and New section. */
function ChatRecentsMenu({ filter, onChange, onNewSection }: {
  filter: ChatRecentsFilter;
  onChange: (change: Partial<ChatRecentsFilter>) => void;
  onNewSection: () => void;
}) {
  const { t } = useTranslation('sidebar');
  const r = (key: string) => t(`workspace.recents.${key}`);
  const statusKey = { active: 'statusActive', archived: 'statusArchived', all: 'statusAll' } as const;
  const scheduledKey = { shown: 'scheduledShown', grouped: 'scheduledGrouped', hidden: 'scheduledHidden' } as const;
  const groupKey = { date: 'groupDate', unread: 'groupUnread', status: 'groupStatus', none: 'groupNone' } as const;
  const sortKey = { name: 'sortName', created: 'sortCreated', activity: 'sortActivity' } as const;
  const sinceKey = SINCE_DAYS.find((option) => option.value === filter.sinceDays)?.key ?? 'allTime';
  return (
    <ScheduledTaskMenu
      trigger={<ListFilter size={16} />}
      ariaLabel={r('filter')}
      title={r('filter')}
      triggerClassName="workspace-recents-action"
      panelClassName="workspace-recents-menu"
    >
      {(close) => (
        <>
          <ScheduledTaskSubmenu label={<MenuChoice label={r('status')} value={r(statusKey[filter.status])} />}>
            {(['active', 'archived', 'all'] as const).map((status) => (
              <ScheduledTaskMenuItem key={status} label={r(statusKey[status])} selected={filter.status === status} onSelect={() => onChange({ status })} />
            ))}
          </ScheduledTaskSubmenu>
          <ScheduledTaskSubmenu label={<MenuChoice label={r('activity')} value={r(sinceKey)} />}>
            {SINCE_DAYS.map((option) => (
              <ScheduledTaskMenuItem key={option.key} label={r(option.key)} selected={filter.sinceDays === option.value} onSelect={() => onChange({ sinceDays: option.value })} />
            ))}
          </ScheduledTaskSubmenu>
          <ScheduledTaskSubmenu label={<MenuChoice label={r('scheduled')} value={r(scheduledKey[filter.scheduled])} />}>
            {(['shown', 'grouped', 'hidden'] as const).map((scheduled) => (
              <ScheduledTaskMenuItem key={scheduled} label={r(scheduledKey[scheduled])} selected={filter.scheduled === scheduled} onSelect={() => onChange({ scheduled })} />
            ))}
          </ScheduledTaskSubmenu>
          <ScheduledTaskMenuDivider />
          <ScheduledTaskSubmenu label={<MenuChoice label={r('groupBy')} value={r(groupKey[filter.groupBy])} />}>
            {(['date', 'unread', 'status'] as const).map((groupBy) => (
              <ScheduledTaskMenuItem key={groupBy} label={r(groupKey[groupBy])} selected={filter.groupBy === groupBy} onSelect={() => onChange({ groupBy })} />
            ))}
            <ScheduledTaskMenuDivider />
            <ScheduledTaskMenuItem label={r('groupNone')} selected={filter.groupBy === 'none'} onSelect={() => onChange({ groupBy: 'none' })} />
          </ScheduledTaskSubmenu>
          <ScheduledTaskSubmenu label={<MenuChoice label={r('sortBy')} value={r(sortKey[filter.sort])} />}>
            {(['name', 'created', 'activity'] as const).map((sort) => (
              <ScheduledTaskMenuItem key={sort} label={r(sortKey[sort])} selected={filter.sort === sort} onSelect={() => onChange({ sort })} />
            ))}
          </ScheduledTaskSubmenu>
          <ScheduledTaskMenuDivider />
          <ScheduledTaskMenuItem label={r('newSection')} onSelect={() => { close(); onNewSection(); }} />
        </>
      )}
    </ScheduledTaskMenu>
  );
}

/** Code's Recents menu: only the order (last updated, date created or name; descending or ascending). */
function CodeRecentsMenu({ filter, onChange }: { filter: CodeRecentsFilter; onChange: (change: Partial<CodeRecentsFilter>) => void }) {
  const { t } = useTranslation('sidebar');
  const r = (key: string) => t(`workspace.recents.${key}`);
  const sortKey = { activity: 'sortUpdated', created: 'sortCreated', name: 'sortName' } as const;
  return (
    <ScheduledTaskMenu
      trigger={<ListFilter size={16} />}
      ariaLabel={r('sort')}
      title={r('sort')}
      triggerClassName="workspace-recents-action"
      panelClassName="workspace-recents-menu"
    >
      {() => (
        <ScheduledTaskSubmenu label={<MenuChoice label={r('sortBy')} value={r(sortKey[filter.sort])} />}>
          {(['activity', 'created', 'name'] as const).map((sort) => (
            <ScheduledTaskMenuItem key={sort} label={r(sortKey[sort])} selected={filter.sort === sort} onSelect={() => onChange({ sort })} />
          ))}
          <ScheduledTaskMenuDivider />
          <ScheduledTaskMenuItem label={r('orderDesc')} selected={filter.order === 'desc'} onSelect={() => onChange({ order: 'desc' })} />
          <ScheduledTaskMenuItem label={r('orderAsc')} selected={filter.order === 'asc'} onSelect={() => onChange({ order: 'asc' })} />
        </ScheduledTaskSubmenu>
      )}
    </ScheduledTaskMenu>
  );
}

/** Names a new section (optionally filing the conversation it was started from) or renames one. */
function SectionDialog({ state, prefs, onClose, onSubmit }: {
  state: SectionDialogState | null;
  prefs: SidebarConversationPrefs;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useTranslation('sidebar');
  const current = state?.mode === 'rename' ? prefs.sections.find((section) => section.id === state.id)?.name ?? '' : '';
  const [draft, setDraft] = useState(current);
  // Start the field from the current name each time the dialog opens.
  const [openedFor, setOpenedFor] = useState(state);
  if (state !== openedFor) {
    setOpenedFor(state);
    if (state) setDraft(current);
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (name) onSubmit(name);
  };
  const creating = state?.mode === 'create';
  const title = creating ? t('workspace.conversationSections.newTitle') : t('workspace.conversationSections.renameTitle');
  return (
    <Dialog open={Boolean(state)} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className="workspace-account-dialog" aria-label={title}>
        <DialogTitle>{title}</DialogTitle>
        <form onSubmit={submit}>
          <input
            autoFocus
            maxLength={60}
            aria-label={t('workspace.conversationSections.name')}
            placeholder={t('workspace.conversationSections.name')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="workspace-primary-button" type="submit" disabled={!draft.trim()}>
            {creating ? t('workspace.conversationSections.create') : t('workspace.conversationSections.save')}
          </button>
        </form>
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

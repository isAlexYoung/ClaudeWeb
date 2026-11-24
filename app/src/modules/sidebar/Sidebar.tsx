import { memo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useSidebarController } from '@/modules/sidebar/hooks/useSidebarController';
import { useTaskMaster, useTasksSettings } from '@/modules/task-master';
import { usePaletteOps } from '@/modules/command-palette';
import { useBackgroundSessionIdSet, useBusySessionIdSet } from '@/shared/context/SessionProtectionContext';
import type { LLMProvider, LoadingProgress, MCPServerStatus, Project, ProjectSession, SettingsMainTab, SidebarProjectListProps } from '@/shared/types';
import IntegratedSidebar from '@/modules/sidebar/IntegratedSidebar';
import SidebarModals from '@/modules/sidebar/SidebarModals';

type SidebarProps = {
  /** Closes the mobile drawer after choosing a main-area page, including the current page. */
  onNavigatePage?: () => void;
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  attentionSessionIds: ReadonlySet<string>;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project) => void;
  onSessionDelete?: (sessionId: string) => void;
  onLoadMoreSessions?: (projectId: string) => Promise<void> | void;
  // `projectId` is the DB identifier; the sidebar hands it back to the parent
  // when the delete flow completes.
  onProjectDelete?: (projectId: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  showSettings: boolean;
  settingsInitialTab: string;
  onCloseSettings: () => void;
  isMobile: boolean;
};

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
  mcpServerStatus: MCPServerStatus;
};

/** Exported through the sidebar barrel; the project-workspace module renders it as the app's project and session navigation panel. */
function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  attentionSessionIds,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onLoadMoreSessions,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  showSettings,
  settingsInitialTab,
  onCloseSettings,
  isMobile,
  onNavigatePage,
}: SidebarProps) {
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { sidebarVisible } = preferences;
  const { setCurrentProject, mcpServerStatus } = useTaskMaster() as TaskMasterSidebarContext;
  const { tasksEnabled } = useTasksSettings();
  const paletteOps = usePaletteOps();
  // Only membership is rendered here, so subscribing to the full activity map
  // would re-render the whole tree on every provider status frame.
  const activeSessions = useBusySessionIdSet();
  const backgroundSessionIds = useBackgroundSessionIdSet();

  const {
    isSidebarCollapsed,
    isProjectExpanded,
    activeRename,
    showNewProject,
    initialSessionsLoaded,
    currentTime,
    searchFilter,
    searchMode,
    setSearchMode,
    conversationResults,
    isSearching,
    isRefreshing,
    deletingProjects,
    pendingDeletion,
    filteredProjects,
    archivedProjects,
    archivedSessions,
    recentConversations,
    recentConversationsHasMore,
    isLoadingMoreRecentConversations,
    reloadRecentConversations,
    loadMoreRecentConversations,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    getProjectSessions,
    loadingMoreProjects,
    loadMoreSessionsForProject,
    startEditingProject,
    startEditingSession,
    updateRenameDraft,
    cancelRename,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    sessionSelection,
    setProjectSessionSelection,
    toggleSessionSelected,
    cancelSessionSelection,
    showDeleteSelectedSessionsConfirmation,
    confirmDeleteSessions,
    requestProjectDelete,
    confirmDeleteProject,
    handleProjectSelect,
    restoreArchivedProject,
    restoreArchivedSession,
    refreshProjects,
    updateSessionSummary,
    forkSession,
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setShowNewProject,
    setSearchFilter,
    setPendingDeletion,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    activeSessions,
    backgroundSessionIds,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onLoadMoreSessions,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
    keepProjectsExpanded: preferences.keepProjectsExpanded,
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  useEffect(() => { reloadRecentConversations(); }, [reloadRecentConversations]);

  const handleProjectCreated = (project?: Record<string, unknown>) => {
    void paletteOps.refreshProjects();
    if (project && typeof project.projectId === 'string') onNewSession(project as Project);
  };

  // Stable so memo() on the row components can bail out; an inline arrow here
  // would give every row a new callback on each sidebar render.
  const handleSaveProjectName = useCallback((projectId: string, nextName: string) => {
    void saveProjectName(projectId, nextName);
  }, [saveProjectName]);

  const handleSaveSessionName = useCallback(
    (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    [updateSessionSummary],
  );

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    isProjectExpanded,
    activeRename,
    initialSessionsLoaded,
    currentTime,
    deletingProjects,
    tasksEnabled,
    mcpServerStatus,
    getProjectSessions,
    loadingMoreProjects,
    activeSessions,
    backgroundSessionIds,
    attentionSessionIds,
    isProjectStarred,
    onRenameDraftChange: updateRenameDraft,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onStartEditingProject: startEditingProject,
    onCancelEditingProject: cancelRename,
    onSaveProjectName: handleSaveProjectName,
    onDeleteProject: requestProjectDelete,
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    onForkSession: forkSession,
    onLoadMoreSessions: loadMoreSessionsForProject,
    onNewSession,
    onStartEditingSession: startEditingSession,
    onCancelEditingSession: cancelRename,
    onSaveEditingSession: handleSaveSessionName,
    sessionSelection,
    onSetSessionSelection: setProjectSessionSelection,
    onToggleSessionSelected: toggleSessionSelected,
    onCancelSessionSelection: cancelSessionSelection,
    onDeleteSelectedSessions: showDeleteSelectedSessionsConfirmation,
    t,
  };

  return (
    <>
      <SidebarModals
        projects={projects}
        showSettings={showSettings}
        settingsInitialTab={settingsInitialTab}
        onCloseSettings={onCloseSettings}
        onArchiveChanged={() => { void refreshProjects(); }}
        showNewProject={showNewProject}
        onCloseNewProject={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
        pendingDeletion={pendingDeletion}
        onCancelDeletion={() => setPendingDeletion(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        onConfirmDeleteSession={confirmDeleteSession}
        onConfirmDeleteSessions={confirmDeleteSessions}
        t={t}
      />

      <IntegratedSidebar
        onNavigatePage={onNavigatePage}
        list={projectListProps}
        collapsed={isSidebarCollapsed}
        onCollapse={handleCollapseSidebar}
        onExpand={handleExpandSidebar}
        onSettings={onShowSettings}
        onRefresh={() => { void refreshProjects(); }}
        isRefreshing={isRefreshing}
        onCreateProject={() => setShowNewProject(true)}
        recent={recentConversations}
        recentHasMore={recentConversationsHasMore}
        isLoadingMoreRecent={isLoadingMoreRecentConversations}
        onLoadMoreRecent={loadMoreRecentConversations}
        archivedProjects={archivedProjects}
        archivedSessions={archivedSessions}
        searchFilter={searchFilter}
        searchMode={searchMode}
        onSearch={setSearchFilter}
        onSearchMode={setSearchMode}
        searchResults={conversationResults}
        isSearching={isSearching}
        onRestoreProject={restoreArchivedProject}
        onRestoreSession={restoreArchivedSession}
        onDeleteArchivedSession={(session) => {
          showDeleteSessionConfirmation(session.sessionId, session.sessionTitle, { isArchived: true });
        }}
        onProjectArchived={onProjectDelete}
        onSessionArchived={onSessionDelete}
      />

    </>
  );
}

export default memo(Sidebar);

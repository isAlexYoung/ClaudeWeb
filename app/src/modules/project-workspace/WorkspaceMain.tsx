import React, { useCallback, useEffect, type Dispatch, type SetStateAction, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatInterface } from '@/modules/chat';
import { FileTree } from '@/modules/file-tree';
import { StandaloneShell } from '@/modules/standalone-shell';
import { GitPanel } from '@/modules/git-panel';
import { PluginsPage, PluginTabContent, useOptionalPlugins } from '@/modules/plugins';
import { usePaletteOps, usePaletteOpsRegister } from '@/modules/command-palette';
import { TaskMasterPanel, useTaskMasterProjectSync, useTasksSettings } from '@/modules/task-master';
import type { AppTab, DirectoryRevealRequest, Project, ProjectSession, SessionEstablishedContext, SessionNavigationOptions, SettingsMainTab, TurnChanges } from '@/shared/types';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { useViewMotion } from '@/shared/hooks/useViewMotion';
import { isGeneratedFilePath } from '@/shared/utils';
import { useFileOpenResolver } from '@/modules/project-workspace/hooks/useFileOpenResolver';
import { EditorSidebar, useEditorSidebar } from '@/modules/code-editor';
import IntegratedWorkspaceHeader from '@/modules/project-workspace/IntegratedWorkspaceHeader';
import WorkspaceContextInspector from '@/modules/project-workspace/WorkspaceContextInspector';
import WorkspaceInspectorDock from '@/modules/project-workspace/WorkspaceInspectorDock';
import WorkspaceProjectPicker from '@/modules/project-workspace/WorkspaceProjectPicker';
import { UsageDashboard } from '@/modules/usage-dashboard';
import { useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import WorkspaceStateView from '@/modules/project-workspace/WorkspaceStateView';
import WorkspaceErrorBoundary from '@/modules/project-workspace/WorkspaceErrorBoundary';
import { ScheduledTasksPage } from '@/modules/scheduled-tasks';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import { useWorkspaceTools } from '@/modules/project-workspace/context/WorkspaceToolsContext';

type WorkspaceMainProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onNavigateToSession: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings: (tab?: SettingsMainTab) => void;
  externalMessageUpdate: number;
  newSessionTrigger: number;
  /** Switches the app to another project — used by the git panel's Worktrees view. */
  onProjectSelect: (project: Project) => void;
  /** Silently re-syncs the sidebar project list after worktree projects change. */
  onProjectsRefresh: () => void;
  /** Persists a new title for a session; resolves false when the backend refuses it. Used by the header's inline rename. */
  onRenameSession: (sessionId: string, summary: string) => Promise<boolean>;
};

/** Rendered by ProjectMainRegion to show the selected project's active tab: chat, files, shell, git, tasks or a plugin. */
function WorkspaceMain({
  projects,
  selectedProject,
  selectedSession,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  isMobile,
  onMenuClick,
  isLoading,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  externalMessageUpdate,
  newSessionTrigger,
  onProjectSelect,
  onProjectsRefresh,
  onRenameSession,
}: WorkspaceMainProps) {
  const { t } = useTranslation('common');
  const experience = useWorkspaceExperience();
  const isCodeHome = experience.home && experience.mode === 'project';
  const tools = useWorkspaceTools();
  const paletteOps = usePaletteOps();
  const pluginsCtx = useOptionalPlugins();

  // Keep global plugins (overlay/background/settings) synchronized with the live active project, session, and route.
  const setPluginWorkspaceContext = pluginsCtx?.setWorkspaceContext;
  useEffect(() => {
    setPluginWorkspaceContext?.({
      route: experience.pluginsOpen ? 'plugins' : experience.scheduledTasksOpen ? 'scheduled-tasks' : 'workspace',
      project: selectedProject
        ? {
            name: selectedProject.projectId,
            path: selectedProject.fullPath || selectedProject.path || '',
          }
        : null,
      session: selectedSession
        ? {
            id: selectedSession.id,
            title: selectedSession.title || selectedSession.name || selectedSession.id,
          }
        : null,
    });
  }, [
    experience.scheduledTasksOpen,
    experience.pluginsOpen,
    selectedProject,
    selectedSession,
    setPluginWorkspaceContext,
  ]);
  // New Chat starts closed; opening a saved conversation keeps the desktop dock behavior.
  const [inspectorOpen, setInspectorOpen] = useState(() => !experience.home && matchMedia('(min-width: 1100px)').matches);
  // Shell and files return to the same live Context/Connectors view.
  const [inspectorView, setInspectorView] = useState<'context' | 'shell' | 'files' | 'browser' | 'changes'>('context');
  // A change summary card opens its turn's diff in the right panel, on the file clicked.
  const [openedChanges, setOpenedChanges] = useState<{ changes: TurnChanges; path: string } | null>(null);
  const openChanges = useCallback((changes: TurnChanges, path: string) => {
    setOpenedChanges({ changes, path });
    setInspectorView('changes');
    setInspectorOpen(true);
  }, []);
  // Another conversation's changes are not this one's: leave the Changes view when the session changes.
  useEffect(() => {
    setOpenedChanges(null);
    setInspectorView((view) => (view === 'changes' ? 'context' : view));
  }, [selectedSession?.id]);
  useEffect(() => {
    // A fresh New Chat request closes the dock even when already on the landing page.
    // Manual toggles remain available until the next home request or mobile transition.
    if (isMobile || experience.home) setInspectorOpen(false);
  }, [isMobile, experience.home, experience.homeRequest]);
  const viewRef = useViewMotion([activeTab, selectedProject?.projectId, selectedSession?.id, newSessionTrigger, experience.mode, isLoading].join(':'));
  const preferences = useUiPreferences();
  const { showRawParameters, showThinking, sendByCtrlEnter, changeSummaryEnabled } = preferences;

  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();

  useTaskMasterProjectSync(selectedProject);
  // The folder an in-chat `path/` reference asked to reveal. Held as an object
  // so that re-clicking the same folder is a new request the tree acts on.
  const [revealDirectory, setRevealDirectory] = useState<DirectoryRevealRequest | null>(null);

  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);

  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
    handleUnsavedChangesChange,
  } = useEditorSidebar({
    selectedProject,
    isMobile,
  });

  // Resolves bare/partial file references (e.g. links inside chat messages) to
  // real project files before opening them in the in-app editor.
  const openChatReference = useCallback((path: string, diff?: any, line?: number | null) => {
    const isDeliverable = !diff && !line && isGeneratedFilePath(path);
    handleFileOpen(path, diff, line ?? null, isDeliverable ? 'preview' : 'editor');
  }, [handleFileOpen]);
  const resolvedFileOpen = useFileOpenResolver(selectedProject, openChatReference);

  useEffect(() => {
    if (!shouldShowTasksTab && activeTab === 'tasks') {
      setActiveTab('chat');
    }
  }, [shouldShowTasksTab, activeTab, setActiveTab]);

  // Stable so React.memo(ChatInterface) can bail out: an inline arrow here made
  // every WorkspaceMain render re-render the whole chat tree, including during
  // an editor-divider drag.
  const showAllTasks = useCallback(() => {
    setActiveTab('tasks');
  }, [setActiveTab]);

  const openFile = useCallback((filePath: string) => {
    if (handleFileOpen(filePath)) {
      setActiveTab('files');
    }
  }, [handleFileOpen, setActiveTab]);

  // Opens the editor side panel in place, keeping the current tab (e.g. chat).
  const openFileInEditor = useCallback((filePath: string, line?: number | null) => {
    resolvedFileOpen(filePath, undefined, line);
  }, [resolvedFileOpen]);

  // Directories cannot be read as text: reveal them in the file tree instead.
  const openDirectory = useCallback((directoryPath: string) => {
    setActiveTab('files');
    setRevealDirectory({ path: directoryPath });
  }, [setActiveTab]);

  // Stable arguments keep usePaletteOpsRegister's effect from tearing down and
  // rewriting the whole palette registry on every render.
  usePaletteOpsRegister({ openFile, openFileInEditor, openDirectory });

  if (experience.pluginsOpen) {
    return <div className="workspace-main flex h-full min-w-0 overflow-hidden">
      <PluginsPage currentProjects={projects} menuButton={isMobile ? <MobileMenuButton onMenuClick={onMenuClick} /> : null}
        browserMinimized={tools.minimized.browser}
        onOpenBrowser={() => { tools.openBrowser(); setInspectorView('browser'); setInspectorOpen(true); }} />
      <WorkspaceInspectorDock mobile={isMobile} open={inspectorOpen && inspectorView === 'browser'} wide>
        <WorkspaceContextInspector view="browser" project={selectedProject} session={selectedSession} onBack={() => setInspectorOpen(false)} onFileOpen={handleFileOpen} />
      </WorkspaceInspectorDock>
    </div>;
  }

  if (isLoading) {
    return <WorkspaceStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (experience.scheduledTasksOpen) {
    return (
      <ScheduledTasksPage
        menuButton={isMobile ? <MobileMenuButton onMenuClick={onMenuClick} /> : null}
        onOpenSession={(sessionId) => {
          experience.enterSession(sessionId);
          onNavigateToSession(sessionId);
        }}
        onStartChat={experience.startChatWithDraft}
      />
    );
  }

  const header = (
    <IntegratedWorkspaceHeader
      project={selectedProject}
      session={selectedSession}
      mobile={isMobile}
      inspectorOpen={inspectorOpen}
      onDesktop={tools.openDesktop}
      minimizedTools={tools.minimized}
      onMenu={onMenuClick}
      onInspectorToggle={() => setInspectorOpen((value) => !value)}
      onTool={(tool) => {
        // The terminal and browser open once and then keep running until the user closes them.
        if (tool === 'shell' && selectedProject) tools.openTerminal(selectedProject, selectedSession);
        if (tool === 'browser') tools.openBrowser();
        setInspectorView(tool);
        setInspectorOpen(true);
      }}
      onTasks={() => (shouldShowTasksTab ? setActiveTab('tasks') : onShowSettings('tasks'))}
      onOpenPluginTab={(pluginName) => setActiveTab(`plugin:${pluginName}`)}
      onRenameSession={selectedSession ? (summary) => onRenameSession(selectedSession.id, summary) : undefined}
    />
  );

  if (!selectedProject && !isCodeHome) {
    return (
      <div ref={viewRef} className="workspace-main flex h-full flex-col">
        {header}
          {/* Standalone chat is waiting for its working directory to be registered. */}
          <div className="workspace-preparing">
            <p role="status">
              {experience.homeError
                ? t('workspace.home.chatWorkspaceUnavailable')
                : t('workspace.home.preparingChat')}
            </p>
            <button onClick={() => experience.openHome('chat')}>{t('workspace.home.retry')}</button>
          </div>
      </div>
    );
  }

  return (
    <div ref={viewRef} className="workspace-main flex h-full flex-col">
      {header}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className={`flex min-h-0 min-w-[200px] flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <WorkspaceErrorBoundary showDetails>
              <ChatInterface
                homeContent={isCodeHome ? <UsageDashboard /> : undefined}
                composerLeading={isCodeHome ? <WorkspaceProjectPicker /> : undefined}
                isActive={activeTab === 'chat'}
                selectedProject={selectedProject}
                selectedSession={selectedSession}
                ws={ws}
                sendMessage={sendMessage}
                onFileOpen={handleFileOpen}
                onNavigateToSession={onNavigateToSession}
                onSessionEstablished={onSessionEstablished}
                onShowSettings={onShowSettings}
                showRawParameters={showRawParameters}
                showThinking={showThinking}
                showChangeSummary={changeSummaryEnabled}
                onOpenChanges={openChanges}
                sendByCtrlEnter={sendByCtrlEnter}
                externalMessageUpdate={externalMessageUpdate}
                newSessionTrigger={newSessionTrigger}
                onShowAllTasks={tasksEnabled ? showAllTasks : null}
              />
            </WorkspaceErrorBoundary>
          </div>

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <FileTree
                selectedProject={selectedProject}
                onFileOpen={handleFileOpen}
                revealDirectory={revealDirectory}
              />
            </div>
          )}

          {activeTab === 'shell' && (
            <div className="h-full w-full overflow-hidden">
              <StandaloneShell
                project={selectedProject}
                session={selectedSession}
                showHeader={false}
                isActive={activeTab === 'shell'}
              />
            </div>
          )}

          {activeTab === 'git' && (
            <div className="h-full overflow-hidden">
              <GitPanel
                selectedProject={selectedProject}
                isMobile={isMobile}
                onFileOpen={handleFileOpen}
                onProjectSelect={onProjectSelect}
                onProjectsRefresh={onProjectsRefresh}
              />
            </div>
          )}

          {shouldShowTasksTab && <TaskMasterPanel isVisible={activeTab === 'tasks'} onBack={() => setActiveTab('chat')} />}

          {activeTab.startsWith('plugin:') && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="workspace-taskmaster-bar border-b border-border/60 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('chat')}
                  className="workspace-taskmaster-back"
                >
                  ← {t('commandPalette.navChat', { defaultValue: 'Back to chat' })}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <PluginTabContent
                  pluginName={activeTab.replace('plugin:', '')}
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                />
              </div>
            </div>
          )}
        </div>

        <WorkspaceInspectorDock open={inspectorOpen && !editingFile} mobile={isMobile} wide={inspectorView === 'browser' || inspectorView === 'changes'}>
          <WorkspaceContextInspector view={inspectorView} project={selectedProject} session={selectedSession}
            onBack={() => setInspectorView('context')} onFileOpen={handleFileOpen}
            changes={openedChanges} onSelectChange={(path) => setOpenedChanges((current) => current && { ...current, path })} />
        </WorkspaceInspectorDock>
        <EditorSidebar
          onContinueEditing={(path) => {
            setActiveTab('chat');
            paletteOps.insertComposerText(t('workspace.files.continuePrompt', { path }));
          }}
          onOpenSource={(path) => { handleFileOpen(path); }}
          editingFile={editingFile}
          isMobile={isMobile}
          editorExpanded={editorExpanded}
          editorWidth={editorWidth}
          hasManualWidth={hasManualWidth}
          resizeHandleRef={resizeHandleRef}
          onResizeStart={handleResizeStart}
          onCloseEditor={handleCloseEditor}
          onToggleEditorExpand={handleToggleEditorExpand}
          onUnsavedChangesChange={handleUnsavedChangesChange}
          projectPath={selectedProject?.path}
          fillSpace={activeTab === 'files'}
        />
      </div>
    </div>
  );
}

export default React.memo(WorkspaceMain);

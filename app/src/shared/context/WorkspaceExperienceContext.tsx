import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type {
  TranscriptActions,
  ContextUsageDetails, WorkspaceExperience,
  WorkspaceHomeError,
  WorkspaceMode,
  WorkspaceSessionPreferences,
  Project,
} from '@/shared/types';

const Context = createContext<WorkspaceExperience | null>(null);

const readStringList = (value: unknown): string[] => (
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
);

function readSessions(): WorkspaceSessionPreferences {
  const saved = readUserPreference<Partial<WorkspaceSessionPreferences>>('workspaceSessions', {});
  return {
    chatSessionIds: readStringList(saved.chatSessionIds),
    pinnedSessionIds: readStringList(saved.pinnedSessionIds),
  };
}

/** Mounted by ProjectWorkspaceRoute; shares the approved navigation flow, inspector data and transcript actions. */
export function WorkspaceExperienceProvider({ children }: { children: ReactNode }) {
  // A mode is a navigation choice, independent of the provider/model catalog.
  const [mode, setMode] = useState<WorkspaceMode>('chat');
  // Only the New Chat entry shows the landing experience, never a project's new-session action.
  const [home, setHome] = useState(() => !location.pathname.includes('/session/'));
  // Main-area pages are mutually exclusive and leave the last conversation available to resume.
  const [mainPage, setMainPage] = useState<'workspace' | 'scheduled-tasks' | 'plugins'>('workspace');
  const scheduledTasksOpen = mainPage === 'scheduled-tasks';
  const pluginsOpen = mainPage === 'plugins';
  // Reopening New Chat must reset an existing draft even when the mode is unchanged.
  const [homeRequest, setHomeRequest] = useState(0);
  // A failed chat-workspace preparation stays visible until a new attempt is requested.
  const [homeError, setHomeError] = useState<WorkspaceHomeError | null>(null);
  // Text another page (scheduled tasks) wants the next Chat landing composer to start with.
  // It must outlive the navigation: chat only mounts once the chat workspace is ready.
  const [homeDraft, setHomeDraft] = useState<string | null>(null);
  // Each mode remembers the conversation it last displayed; explicit New Chat clears only its own slot.
  const lastSessions = useRef<Record<WorkspaceMode, string | null>>({ chat: null, project: null });
  // Routing remains owned by project-workspace; the shared context only issues this navigation intent.
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  // A Code landing folder can change without throwing away its unsent composer draft.
  const [homeProject, selectHomeProject] = useState<Project | null>(null);
  // Classifications and pins follow the account across reloads/devices via user preferences.
  const [sessions, setSessions] = useState(readSessions);
  // Published by the active chat, then read by the right-hand Context inspector.
  const [contextUsage, setContextUsage] = useState<Record<string, unknown> | null>(null);
  // SDK category snapshots are independent of input/output billing counters.
  const [contextDetails, setContextDetails] = useState<ContextUsageDetails | null>(null);
  // Registered by the open transcript so the header's More menu can copy or export it.
  const [transcriptActions, setTranscriptActions] = useState<TranscriptActions | null>(null);

  useEffect(() => subscribeToUserPreferences(() => setSessions(readSessions())), []);

  const openHome = useCallback((nextMode: WorkspaceMode = 'chat') => {
    lastSessions.current[nextMode] = null;
    setResumeSessionId(null);
    selectHomeProject(null);
    setMode(nextMode);
    setHome(true);
    setMainPage('workspace');
    setHomeRequest((value) => value + 1);
    setContextUsage(null);
    setContextDetails(null);
    setHomeError(null);
    // A plain New Chat never inherits a prompt that was meant for an earlier one.
    setHomeDraft(null);
  }, []);

  const startChatWithDraft = useCallback((text: string) => {
    openHome('chat');
    // Set after openHome's reset; both updates land in the same render.
    setHomeDraft(text);
  }, [openHome]);

  const consumeHomeDraft = useCallback(() => setHomeDraft(null), []);

  const switchMode = useCallback((nextMode: WorkspaceMode) => {
    if (nextMode === mode && mainPage === 'workspace') return;
    const session = lastSessions.current[nextMode];
    if (!session) { openHome(nextMode); return; }
    setMode(nextMode);
    setHome(false);
    setMainPage('workspace');
    setResumeSessionId(session);
    setContextUsage(null);
    setContextDetails(null);
  }, [mode, openHome, mainPage]);

  const enterProject = useCallback(() => {
    lastSessions.current.project = null;
    setResumeSessionId(null);
    setMode('project');
    setHome(false);
    setMainPage('workspace');
    setContextUsage(null);
    setContextDetails(null);
  }, []);

  const enterSession = useCallback((id: string, modeHint?: WorkspaceMode) => {
    const saved = readSessions();
    const sessionMode = modeHint ?? (saved.chatSessionIds.includes(id) ? 'chat' : 'project');
    // Persist a directory-derived classification before a subsequent URL change resolves the same session.
    if (sessionMode === 'chat' && !saved.chatSessionIds.includes(id)) {
      writeUserPreference('workspaceSessions', { ...saved, chatSessionIds: [...saved.chatSessionIds, id] });
    }
    lastSessions.current[sessionMode] = id;
    setResumeSessionId(null);
    setMode(sessionMode);
    setHome(false);
    setMainPage('workspace');
    setContextUsage(null);
    setContextDetails(null);
  }, []);

  const rememberSession = useCallback((id: string) => {
    lastSessions.current[mode] = id;
    setResumeSessionId(null);
    if (mode === 'chat') {
      const saved = readSessions();
      writeUserPreference('workspaceSessions', { ...saved, chatSessionIds: [...new Set([...saved.chatSessionIds, id])] });
    }
    setHome(false);
  }, [mode]);

  const openScheduledTasks = useCallback(() => {
    setMainPage('scheduled-tasks');
    setContextUsage(null);
    setContextDetails(null);
  }, []);

  const openPlugins = useCallback(() => {
    setMainPage('plugins');
    setContextUsage(null);
    setContextDetails(null);
  }, []);

  const toggleSessionPin = useCallback((id: string) => {
    const saved = readSessions();
    writeUserPreference('workspaceSessions', {
      ...saved,
      pinnedSessionIds: saved.pinnedSessionIds.includes(id)
        ? saved.pinnedSessionIds.filter((value) => value !== id)
        : [...saved.pinnedSessionIds, id],
    });
  }, []);

  const value = useMemo<WorkspaceExperience>(() => ({
    mode,
    home,
    scheduledTasksOpen,
    openScheduledTasks,
    pluginsOpen,
    openPlugins,
    homeRequest,
    homeError,
    contextUsage,
    contextDetails,
    setContextDetails,
    transcriptActions,
    ...sessions,
    openHome,
    homeDraft,
    startChatWithDraft,
    consumeHomeDraft,
    switchMode,
    resumeSessionId,
    homeProject,
    selectHomeProject,
    enterProject,
    enterSession,
    rememberSession,
    toggleSessionPin,
    setContextUsage,
    setHomeError,
    setTranscriptActions,
  }), [
    mode, home, scheduledTasksOpen, pluginsOpen, homeRequest, homeError, contextUsage, contextDetails, transcriptActions, sessions,
    openHome, homeDraft, startChatWithDraft, consumeHomeDraft, switchMode, resumeSessionId, homeProject, openScheduledTasks, openPlugins, enterProject, enterSession, rememberSession, toggleSessionPin,
  ]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Used by project-workspace, sidebar and chat to share navigation and live context usage. */
export function useWorkspaceExperience(): WorkspaceExperience {
  const value = useContext(Context);
  if (!value) throw new Error('WorkspaceExperienceProvider is required');
  return value;
}

/**
 * Used by chat's transcript, which also renders outside the integrated workspace (tests,
 * other hosts): returns null there instead of throwing.
 */
export function useOptionalWorkspaceExperience(): WorkspaceExperience | null {
  return useContext(Context);
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon } from 'lucide-react';

import { useComposerTaskMenu, useTasksSettings } from '@/modules/task-master';
import { usePaletteOpsRegister } from '@/modules/command-palette';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import PermissionContext from '@/modules/chat/context/PermissionContext';
import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { TranscriptSessionContext } from '@/modules/chat/context/TranscriptSessionContext';
import { api } from '@/shared/api';
import { writeDraftText } from '@/shared/chatDrafts';
import { CHAT_WORKSPACE_PATH } from '@/shared/constants';
import { QuoteDrafts, SelectionTools, useTextQuotes } from '@/modules/side-chat';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import { readUserPreference, subscribeToUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type {
  ChatMessage,
  TextQuote,
  Project,
  ProjectSession,
  SessionEstablishedContext,
  SessionNavigationOptions,
  SettingsMainTab,
  TurnChanges,
} from '@/shared/types';
import { useChatProviderState } from '@/modules/chat/hooks/useChatProviderState';
import { useScheduledMessages } from '@/modules/chat/composer/useScheduledMessages';
import { useChatSessionState } from '@/modules/chat/hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '@/modules/chat/hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { useChatAbortFeedback } from '@/modules/chat/hooks/useChatAbortFeedback';
import { useSessionStore } from '@/modules/chat/hooks/useSessionStore';
import {
  useProcessingSessions,
  useSessionProtectionActions,
} from '@/shared/context/SessionProtectionContext';
import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import ChatTurnNavigator from '@/modules/chat/transcript/ChatTurnNavigator';
import ChatComposer from '@/modules/chat/composer/ChatComposer';
import { ChatHomeGreeting } from '@/modules/chat/ChatHomeGreeting';
import { usePromptSuggestion } from '@/modules/chat/hooks/usePromptSuggestion';
import CommandResultModal from '@/modules/chat/modals/CommandResultModal';

/** Key for a conversation that has no session id yet: one per project and New Chat request. */

type ChatInterfaceProps = {
  isActive: boolean;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onNavigateToSession?: (targetSessionId: string, options?: SessionNavigationOptions) => void;
  onSessionEstablished?: (sessionId: string, context: SessionEstablishedContext) => void;
  onShowSettings?: (tab?: SettingsMainTab) => void;
  showRawParameters?: boolean;
  showThinking?: boolean;
  /** Settings > Tasks and sessions: the card listing what a turn changed. */
  showChangeSummary?: boolean;
  /** Opens the right panel's Changes view on a file from a change summary card. */
  onOpenChanges?: (changes: TurnChanges, path: string) => void;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  newSessionTrigger?: number;
  onTaskClick?: (...args: unknown[]) => void;
  onShowAllTasks?: (() => void) | null;
  /** Code landing content and folder control supplied by project-workspace through the chat module's public API. */
  homeContent?: ReactNode;
  composerLeading?: ReactNode;
  /** Optional header card at the top of the transcript (e.g. a minimized artefact). */
  transcriptHeader?: ReactNode;
  /** Optional composer placeholder override for specialised conversations (e.g. spreadsheets). */
  composerPlaceholder?: string;
};

/**
 * Used by the project-workspace module (via the chat barrel) to render a
 * project session's chat tab; it owns the session, provider, realtime and
 * composer state that ChatMessagesPane and ChatComposer render.
 */
function ChatInterface({
  isActive,
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  onFileOpen,
  onNavigateToSession,
  onSessionEstablished,
  onShowSettings,
  showRawParameters,
  showThinking,
  showChangeSummary = true,
  onOpenChanges,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionTrigger,
  onShowAllTasks,
  homeContent,
  composerLeading,
  transcriptHeader,
  composerPlaceholder,
}: ChatInterfaceProps) {
  const experience = useWorkspaceExperience();
  // Keep the SDK limit event visible without clearing the conversation or inventing quota.
  const [usageLimit, setUsageLimit] = useState<Record<string, unknown> | null>(null);
  useEffect(() => setUsageLimit(null), [selectedSession?.id, selectedProject?.projectId, newSessionTrigger]);
  const { chatMcpEnabled, promptSuggestionsEnabled = true } = useUiPreferences();
  // Fast mode is one remembered choice for every conversation, as with Claude Code's /fast.
  // It costs more, so the model button shows it whenever it is on.
  const [fastMode, setFastMode] = useState(() => readUserPreference<boolean>('composerFastMode', false) === true);
  useEffect(() => subscribeToUserPreferences(() => {
    setFastMode(readUserPreference<boolean>('composerFastMode', false) === true);
  }), []);
  // Stable while typing, so the memoized model menu does not re-render on every keystroke.
  const toggleFastMode = useCallback(() => {
    setFastMode(!fastMode);
    writeUserPreference('composerFastMode', !fastMode);
  }, [fastMode]);
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { subscribe, isConnected } = useWebSocket();
  const { t } = useTranslation('chat');
  const processingSessions = useProcessingSessions();
  const {
    markSessionProcessing: onSessionProcessing,
    markSessionIdle: onSessionIdle,
    markSessionBackground: onSessionBackground,
    getSessionActivity,
  } = useSessionProtectionActions();

  const sessionStore = useSessionStore();
  const streamTimerRef = useRef<number | null>(null);
  const accumulatedStreamRef = useRef('');
  // When each session's `chat.subscribe` was last sent; idle acks older than
  // a later local request are discarded as stale.
  const statusCheckSentAtRef = useRef(new Map<string, number>());
  // Highest live `seq` observed per session. Written by the realtime handler
  // on every sequenced frame, read whenever a `chat.subscribe` is sent so the
  // server replays only the events this client actually missed.
  const lastSeqRef = useRef(new Map<string, number>());

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    accumulatedStreamRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    providerModels,
    setStoredProviderModel,
    currentProviderEffort,
    currentProviderEffortOptions,
    currentProviderModel,
    currentProviderModelOptions,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    availablePermissionModes,
    selectPermissionMode,
    cyclePermissionMode,
    providerModelCatalog,
    providerModelsLoading,
    providerModelActions,
    selectProviderModel,
    selectProviderEffort,
    resolvePermissionModeForProvider,
    supportsMessageEditing,
    supportsSessionForking,
  } = useChatProviderState({
    selectedSession,
    selectedProject,
  });

  const {
    chatMessages,
    addMessage,
    sessionActivity,
    isProcessing,
    canAbortSession,
    currentSessionId,
    setCurrentSessionId,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    revealMessage,
    searchNavigationStatus,
    loadAllMessages,
    loadFullTranscript,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    requestLatestMessages,
  } = useChatSessionState({
    isActive,
    selectedProject,
    selectedSession,
    ws,
    sendMessage,
    externalMessageUpdate,
    newSessionTrigger,
    processingSessions,
    onSessionIdle,
    resetStreamingState,
    statusCheckSentAtRef,
    lastSeqRef,
    sessionStore,
  });

  // The right-hand Context panel shows this chat's token usage.
  const { setContextUsage } = experience;
  useEffect(() => {
    setContextUsage(tokenBudget);
  }, [setContextUsage, tokenBudget]);

  // Brand-new conversation: the composer allocated a stable session id via
  // the session gateway before the first send. Record it locally and put it
  // in the URL — this id never changes again, so there is no later handoff.
  const handleSessionEstablished = useCallback<NonNullable<ChatInterfaceProps['onSessionEstablished']>>((sessionId, context) => {
    setCurrentSessionId(sessionId);
    onSessionEstablished?.(sessionId, context);
    onNavigateToSession?.(sessionId);
  }, [setCurrentSessionId, onSessionEstablished, onNavigateToSession]);

  const quoteDraft = useTextQuotes(selectedSession?.id || currentSessionId || `project:${selectedProject?.projectId || 'new'}`);
  // Source navigation always uses the latest paginated transcript after a history load.
  const sourceNavigationRef = useRef({ chatMessages, revealMessage });
  sourceNavigationRef.current = { chatMessages, revealMessage };
  const captureSideContext = useCallback(async () => {
    const snapshot = chatMessages.map(message => ({ ...message }));
    let context = snapshot;
    if (hasMoreMessages) {
      const history = await loadFullTranscript();
      const firstKey = snapshot[0] ? getIntrinsicMessageKey(snapshot[0]) : null;
      const cutoff = history.findIndex(message => getIntrinsicMessageKey(message) === firstKey);
      // Keep the streaming tail exactly as it was when the user chose Side chat.
      if (cutoff >= 0) context = [...history.slice(0, cutoff), ...snapshot];
    }
    return JSON.stringify(context.map(message => ({
      role: message.type, kind: message.isThinking ? 'thinking' : message.isToolUse ? 'tool_use' : message.isToolResult ? 'tool_result' : 'text',
      text: message.content || '',
      ...(message.isToolUse ? { tool: { name: message.toolName, input: message.toolInput, result: message.toolResult } } : {}),
      attachments: [...(message.files || []), ...(message.images || [])].map(file => ({ name: file.name, path: file.path })),
    })));
  }, [chatMessages, hasMoreMessages, loadFullTranscript]);
  const revealQuoteSource = useCallback(async (source: TextQuote) => {
    const find = (messages: ChatMessage[]) => messages.find(m => getIntrinsicMessageKey(m) === source.messageKey)
      || messages.find(m => new Date(m.timestamp).getTime() === new Date(source.timestamp).getTime() && m.type === source.role)
      || (() => {
        const plain = (text: string) => text.replace(/[`*_#>\\]/g, '').replace(/\s+/g, ' ').trim();
        const matching = messages.filter(m => m.type === source.role && plain(`${m.content || ''} ${m.reasoning || ''}`).includes(plain(source.text)));
        return matching.length === 1 ? matching[0] : undefined;
      })();
    let message = find(sourceNavigationRef.current.chatMessages);
    if (!message && hasMoreMessages) {
      await loadFullTranscript();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      message = find(sourceNavigationRef.current.chatMessages);
    }
    if (!message) return false;
    sourceNavigationRef.current.revealMessage(message, getIntrinsicMessageKey(message) || undefined, false);
    setIsUserScrolledUp(true);
    return true;
  }, [hasMoreMessages, loadFullTranscript, setIsUserScrolledUp]);

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    allSlashCommands,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    setAttachedFiles,
    fileErrors,
    attachmentUpload,
    cancelAttachmentUpload,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker,
    handleSubmit,
    queuedDraft,
    editQueuedDraft,
    deleteQueuedDraft,
    sendQueuedDraftNow,
    saveQueuedDraft,
    isSendingQueuedDraft,
    queuedSendError,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession: sendAbortSession,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    commandModalPayload,
    closeCommandModal,
    showCostModal,
    editingAnchorId,
    beginEditMessage,
    regenerateFromMessage,
    cancelEditMessage,
  } = useChatComposerState({
    quotes: quoteDraft.quotes,
    onQuotesSent: quoteDraft.removeQuotes,
    onQuotesRestored: quoteDraft.replaceQuotes,
    draftScopeOverride: experience.home && experience.mode === 'project' ? `code-home:${experience.homeRequest}` : undefined,
    // Standalone chats follow the chat-mode MCP setting; project sessions keep their own configuration.
    mcpEnabled: experience.mode !== 'chat' || chatMcpEnabled,
    // Sent only for a model the catalog marks as supporting it; the server checks again.
    fastMode: fastMode && currentProviderModelOptions.some((option) => option.value === currentProviderModel && option.supportsFastMode),
    selectedProject,
    selectedSession,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    currentProviderModel,
    currentProviderEffort,
    isLoading: isProcessing,
    processingSessions,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionProcessing,
    onSessionEstablished: handleSessionEstablished,
    onFileOpen,
    onShowSettings,
    scrollToBottom,
    addMessage,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    resolvePermissionModeForProvider,
  });

  const { requestAbort: handleAbortSession, isStopping, stopError } = useChatAbortFeedback({
    sessionId: selectedSession?.id || currentSessionId || null,
    isProcessing, canAbort: canAbortSession, isConnected, abort: sendAbortSession, subscribe,
  });

  const { suggestion, dismiss: dismissSuggestion } = usePromptSuggestion({
    sessionId: experience.home ? null : selectedSession?.id || currentSessionId,
    subscribe, enabled: promptSuggestionsEnabled, input, loading: isProcessing,
    blocked: attachedFiles.length > 0 || Boolean(queuedDraft) || Boolean(editingAnchorId),
  });
  const acceptSuggestion = () => {
    if (!suggestion) return;
    setInput(suggestion);
    dismissSuggestion();
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // On WebSocket reconnect, request a bounded persisted-tail sync (deferred
  // while Chat is hidden), then re-subscribe — the
  // `chat_subscribed` ack restores or clears the activity indicator, replays
  // missed live events, and re-attaches a still-running stream to this socket.
  const handleWebSocketReconnect = useCallback(async () => {
    if (!selectedProject || !selectedSession) return;
    await requestLatestMessages(selectedSession.id, isActive);
    statusCheckSentAtRef.current.set(selectedSession.id, Date.now());
    sendMessage({
      type: 'chat.subscribe',
      sessions: [{
        sessionId: selectedSession.id,
        lastSeq: lastSeqRef.current.get(selectedSession.id) ?? 0,
      }],
    });
  }, [isActive, requestLatestMessages, selectedProject, selectedSession, sendMessage]);

  useChatRealtimeHandlers({
    onContextDetails: experience.setContextDetails,
    onUsageLimit: setUsageLimit,
    isActive,
    subscribe,
    provider,
    selectedSession,
    currentSessionId,
    setTokenBudget,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    streamTimerRef,
    accumulatedStreamRef,
    lastSeqRef,
    statusCheckSentAtRef,
    onSessionProcessing,
    onSessionIdle,
    onSessionBackground,
    getSessionActivity,
    onWebSocketReconnect: handleWebSocketReconnect,
    requestLatestMessages,
    sessionStore,
  });

  // Lets other modules (the quick settings Commands tab) hand text to the
  // composer: append it after a separating space, then focus the textarea with
  // the caret at the end once React has rendered the new value.
  const insertComposerText = useCallback((text: string) => {
    setInput((previous) => {
      const separator = previous && !/\s$/.test(previous) ? ' ' : '';
      return `${previous}${separator}${text}`;
    });
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      const caretPosition = textarea.value.length;
      textarea.setSelectionRange(caretPosition, caretPosition);
    });
  }, [setInput, textareaRef]);

  usePaletteOpsRegister({ insertComposerText });

  // A prompt handed over by another page (a scheduled-task template, "Create with
  // Claude") becomes the Chat landing draft. It is written straight into the
  // landing scope (`project:<chat workspace>`) rather than through setInput:
  // right after New Chat this component can still hold the previous
  // conversation's id for one render, and setInput would file the text under it.
  // The composer's draft subscription then shows it once that scope is current.
  const pendingHomeDraft = experience.homeDraft;
  const consumeHomeDraft = experience.consumeHomeDraft;
  const chatHomeProjectId = experience.home && experience.mode === 'chat'
    && selectedProject && (selectedProject.fullPath || selectedProject.path || '').replace(/\/+$/, '') === CHAT_WORKSPACE_PATH
    ? selectedProject.projectId
    : null;
  useEffect(() => {
    if (!pendingHomeDraft || !chatHomeProjectId) return;
    writeDraftText(`project:${chatHomeProjectId}`, pendingHomeDraft);
    consumeHomeDraft?.();
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [pendingHomeDraft, chatHomeProjectId, consumeHomeDraft, textareaRef]);

  // Task prompts replace the draft: each one is a complete instruction the user reviews before sending.
  const replaceComposerText = useCallback((text: string) => {
    setInput(text);
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }, [setInput, textareaRef]);
  const { menu: composerTaskMenu, setupDialog: taskMasterSetupDialog } = useComposerTaskMenu({
    onInsertPrompt: replaceComposerText,
    onShowBoard: onShowAllTasks,
  });

  useEffect(() => {
    if (!canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      // A floating conversation owns its keyboard; Escape there must never stop the main model.
      if (event.target instanceof Element && event.target.closest('[data-side-chat-surface]')) return;
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      if (suggestion && event.target === textareaRef.current) {
        event.preventDefault();
        dismissSuggestion();
        return;
      }
      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, suggestion, dismissSuggestion, textareaRef]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  /**
   * Branches the conversation into a new session that ends at this message,
   * then opens it. The session being viewed is left exactly as it was.
   */
  const handleForkFromMessage = useCallback(async (message: ChatMessage) => {
    const anchorId = message.transcriptAnchorId;
    const sourceSessionId = selectedSession?.id;
    if (!anchorId || !sourceSessionId) return;

    try {
      const response = await api.forkSession(sourceSessionId, { upToAnchorId: anchorId });
      const payload = await response.json();
      const forkedSessionId = payload?.data?.sessionId;
      if (!response.ok || typeof forkedSessionId !== 'string') {
        throw new Error(payload?.message || `HTTP ${response.status}`);
      }
      onNavigateToSession?.(forkedSessionId);
    } catch (error) {
      console.error('Error forking session:', error);
    }
  }, [onNavigateToSession, selectedSession?.id]);

  const { scheduledMessages, schedule: scheduleMessage, cancel: cancelScheduledMessage } =
    useScheduledMessages(currentSessionId || selectedSession?.id || null, subscribe);

  /**
   * Hands the composer's current text to the server to send later, and clears
   * the box as a send would — the message has left the composer either way.
   */
  const handleScheduleMessage = useCallback(async (scheduledFor: Date) => {
    const content = input.trim();
    if (!content) return;

    const scheduled = await scheduleMessage({
      content,
      scheduledFor,
      options: { model: currentProviderModel, effort: currentProviderEffort, permissionMode },
    });
    if (scheduled) {
      setInput('');
    }
  }, [currentProviderEffort, currentProviderModel, input, permissionMode, scheduleMessage, setInput]);

  const permissionContextValue = useMemo(() => ({
    pendingPermissionRequests,
    handlePermissionDecision,
  }), [pendingPermissionRequests, handlePermissionDecision]);

  // Completed file edits refresh inline deliverables, without reloading on each streamed token.
  const visualFileRevision = useMemo(() => {
    const edit = [...chatMessages].reverse().find(message => message.isToolUse && ['Write', 'Edit', 'Bash'].includes(message.toolName || '') && message.toolResult && !message.toolResult.isError);
    return edit ? String(edit.id || edit.toolId || edit.timestamp || '') : '';
  }, [chatMessages]);
  // Lets markdown images and interactive files resolve against this project and stop in hidden tabs.
  const markdownWorkspaceValue = useMemo(() => ({
    projectId: selectedProject?.projectId ?? null,
    fileRevision: visualFileRevision,
    active: isActive,
  }), [selectedProject?.projectId, visualFileRevision, isActive]);

  // Lets a workflow card fetch its agents' timelines for this session.
  const transcriptSessionValue = useMemo(() => ({ sessionId: currentSessionId }), [currentSessionId]);

  // A composer pick becomes the default for new chats and, when a session is
  // open, is recorded against that session so reopening it restores this model.
  const handleSelectComposerModel = useCallback(async (model: string) => {
    try {
      await selectProviderModel(provider, model, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing the active session model:', error);
    }
  }, [currentSessionId, provider, selectProviderModel, selectedSession?.id]);

  const handleSelectComposerEffort = useCallback(async (effort: string) => {
    try {
      await selectProviderEffort(provider, effort, currentSessionId || selectedSession?.id || null);
    } catch (error) {
      console.error('Error changing the active session reasoning effort:', error);
    }
  }, [currentSessionId, provider, selectProviderEffort, selectedSession?.id]);

  // The transcript's running line steps aside while a permission request is
  // waiting: the composer's banner is then what the session is waiting on.
  const transcriptActivity = pendingPermissionRequests.length === 0 ? sessionActivity : null;

  const selectedProviderLabel = t('messageTypes.claude');
  // New Chat in chat mode centres the composer under a greeting, as in the approved layout.
  const isChatHome = experience.home && experience.mode === 'chat';
  const isCodeHome = experience.home && experience.mode === 'project';

  if (!selectedProject) {
    if (isCodeHome) return <div className="workspace-chat workspace-code-home flex h-full min-h-0 flex-col">
      <div className="workspace-code-home-content">{homeContent}</div>
      <div className="workspace-code-home-preparing">
        <p role="status">{t(experience.homeError ? 'common:workspace.codeHome.unavailable' : 'common:workspace.codeHome.preparing')}</p>
        {composerLeading}
        {experience.homeError && <button type="button" onClick={() => experience.openHome('project')}>{t('common:buttons.retry')}</button>}
      </div>
    </div>;
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }


  return (
    <PermissionContext.Provider value={permissionContextValue}>
      <div className={`workspace-chat flex h-full min-h-0 flex-col ${isChatHome ? 'workspace-chat-home' : ''} ${isCodeHome ? 'workspace-code-home' : ''}`}>
        {isChatHome && <ChatHomeGreeting key={experience.homeRequest} />}
        {isCodeHome && <div className="workspace-code-home-content">{homeContent}</div>}
        {usageLimit?.status === 'rejected' && !usageLimit.isUsingOverage && usageLimit.overageStatus !== 'allowed' && usageLimit.overageStatus !== 'allowed_warning' && <div className="workspace-limit-notice" role="alert">
          <strong>{t('workspace.composer.limitReached')}</strong>
          <p>{t('workspace.composer.limitExplanation')}</p>
          {typeof usageLimit.resetsAt === 'number' && <p>{t('workspace.composer.limitReset', { time: new Date(usageLimit.resetsAt * 1000).toLocaleString() })}</p>}
        </div>}
        <MarkdownWorkspaceContext.Provider value={markdownWorkspaceValue}>
          <TranscriptSessionContext.Provider value={transcriptSessionValue}>
            <div className="workspace-transcript-region relative flex min-h-0 flex-1">
            <ChatMessagesPane
              hideEmptyState
              scrollContainerRef={scrollContainerRef}
              // Not redundant with the `scroll` listener. A first page is 20 rows,
              // tool results fold into their calls, and the "load earlier" link is
              // hidden while more pages exist — so a short transcript is often not
              // scrollable at all and never emits `scroll`. Wheel and touch are
              // then the only way to reach the top pager or the "load all" overlay.
              onWheel={handleScroll}
              onTouchMove={handleScroll}
              isLoadingSessionMessages={isLoadingSessionMessages}
              isProcessing={isProcessing}
              activity={transcriptActivity}
              chatMessages={chatMessages}
              selectedSession={selectedSession}
              currentSessionId={currentSessionId}
              provider={provider}
              setProvider={setProvider}
              textareaRef={textareaRef}
              providerModels={providerModels}
              setProviderModel={setStoredProviderModel}
              providerModelCatalog={providerModelCatalog}
              providerModelActions={providerModelActions}
              providerModelsLoading={providerModelsLoading}
              tasksEnabled={tasksEnabled}
              isTaskMasterInstalled={isTaskMasterInstalled}
              onShowAllTasks={onShowAllTasks}
              setInput={setInput}
              isLoadingMoreMessages={isLoadingMoreMessages}
              hasMoreMessages={hasMoreMessages}
              totalMessages={totalMessages}
              sessionMessagesCount={chatMessages.length}
              visibleMessageCount={visibleMessageCount}
              visibleMessages={visibleMessages}
              loadEarlierMessages={loadEarlierMessages}
              revealMessage={revealMessage}
              backgroundTasks={sessionActivity?.tasks}
              sendMessage={sendMessage}
              loadAllMessages={loadAllMessages}
              allMessagesLoaded={allMessagesLoaded}
              isLoadingAllMessages={isLoadingAllMessages}
              loadAllJustFinished={loadAllJustFinished}
              showLoadAllOverlay={showLoadAllOverlay}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={handleGrantToolPermission}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              showChangeSummary={showChangeSummary}
              onOpenChanges={onOpenChanges}
              selectedProject={selectedProject}
              // Editing replaces the turn and everything after it, so it is only
              // offered when the session is idle — a half-truncated transcript with
              // a live stream writing into it is not recoverable.
              onEditMessage={supportsMessageEditing && !isProcessing ? beginEditMessage : undefined}
              onRegenerateMessage={supportsMessageEditing && !isProcessing ? regenerateFromMessage : undefined}
              onForkFromMessage={supportsSessionForking ? handleForkFromMessage : undefined}
              transcriptHeader={transcriptHeader}
              onLoadFullTranscript={loadFullTranscript}
            />
              <ChatTurnNavigator
                key={`${selectedProject.projectId}:${selectedSession?.id || currentSessionId || newSessionTrigger || 'draft'}`}
                messages={chatMessages}
                scrollContainerRef={scrollContainerRef}
                hasOlderMessages={hasMoreMessages && !allMessagesLoaded}
                loadHistory={loadFullTranscript}
                onReveal={revealMessage}
              />
            </div>
          </TranscriptSessionContext.Provider>
        </MarkdownWorkspaceContext.Provider>

        <div className="relative flex-shrink-0">
          {searchNavigationStatus && <p role={searchNavigationStatus === 'loading' ? 'status' : 'alert'} className="mx-auto mb-2 max-w-[54.25rem] px-4 text-xs text-muted-foreground">{t(`searchNavigation.${searchNavigationStatus}`)}</p>}
          {isUserScrolledUp && chatMessages.length > 0 && (
            <div className="pointer-events-none absolute -top-11 left-0 right-0 z-20 flex justify-center">
              <button
                type="button"
                onClick={scrollToBottomAndReset}
                aria-label={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
                className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-all duration-200 hover:bg-accent hover:text-foreground"
                title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
              >
                <ArrowDownIcon className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}

          <QuoteDrafts quotes={quoteDraft.quotes} onRemove={quoteDraft.removeQuotes} />
          <ChatComposer
            suggestion={suggestion}
            onAcceptSuggestion={acceptSuggestion}
            isChatHome={isChatHome}
          leadingOptions={composerLeading}
          pendingPermissionRequests={pendingPermissionRequests}
          handlePermissionDecision={handlePermissionDecision}
          handleGrantToolPermission={handleGrantToolPermission}
          isLoading={isProcessing}
          isStopping={isStopping}
          stopError={stopError}
          onAbortSession={handleAbortSession}
          permissionMode={permissionMode}
          availablePermissionModes={availablePermissionModes}
          onSelectPermissionMode={selectPermissionMode}
          providerLabel={selectedProviderLabel}
          effort={currentProviderEffort}
          availableEffortOptions={currentProviderEffortOptions}
          onSelectEffort={handleSelectComposerEffort}
          model={currentProviderModel}
          availableModelOptions={currentProviderModelOptions}
          fastMode={fastMode}
          onToggleFastMode={toggleFastMode}
          onSelectModel={handleSelectComposerModel}
          modelsLoading={providerModelsLoading}
          tokenBudget={tokenBudget}
          onShowTokenUsage={showCostModal}
          isEditingSentMessage={Boolean(editingAnchorId)}
          onCancelEditMessage={cancelEditMessage}
          scheduledMessages={scheduledMessages}
          onScheduleMessage={handleScheduleMessage}
          onCancelScheduledMessage={cancelScheduledMessage}
          allSlashCommands={allSlashCommands}
          slashCommandsCount={slashCommandsCount}
          onToggleCommandMenu={handleToggleCommandMenu}
          hasInput={Boolean(input.trim())}
          onClearInput={handleClearInput}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          queuedDraft={queuedDraft}
          onOpenUsageSettings={onShowSettings ? () => onShowSettings('usage') : undefined}
          onEditQueuedDraft={editQueuedDraft}
          onDeleteQueuedDraft={deleteQueuedDraft}
          onSendQueuedDraftNow={sendQueuedDraftNow}
          onSaveQueuedDraft={saveQueuedDraft}
          isSendingQueuedDraft={isSendingQueuedDraft}
          queuedSendError={queuedSendError}
          attachedFiles={attachedFiles}
          onRemoveAttachment={(index) =>
            setAttachedFiles((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          fileErrors={fileErrors}
          attachmentUpload={attachmentUpload}
          onCancelAttachmentUpload={cancelAttachmentUpload}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={commandQuery ? [] : frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openAttachmentPicker={openAttachmentPicker}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={(event) => { dismissSuggestion(); handleInputChange(event); }}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={(event) => {
            if (suggestion && !event.nativeEvent.isComposing && event.keyCode !== 229 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
              if (event.key === 'Tab' || event.key === 'ArrowRight') { event.preventDefault(); acceptSuggestion(); return; }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissSuggestion(); return; }
            }
            handleKeyDown(event);
          }}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder={composerPlaceholder ?? t('input.placeholder', { provider: selectedProviderLabel })}
          customPlaceholder={composerPlaceholder}
          showQuotaRing={experience.mode !== 'chat'}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          taskMenu={composerTaskMenu}
        />
        {taskMasterSetupDialog}
        </div>
      </div>

      <SelectionTools parentSessionId={selectedSession?.id || currentSessionId || null} active={isActive && !experience.home}
        memoryProject={experience.mode === 'project' && selectedProject?.projectId ? { id: selectedProject.projectId, name: selectedProject.displayName || selectedProject.projectId } : null}
        containerRef={scrollContainerRef} messages={chatMessages} modelOptions={currentProviderModelOptions} model={currentProviderModel} effort={currentProviderEffort}
        provider={provider} onQuote={quoteDraft.addQuote} onReveal={revealQuoteSource} captureContext={captureSideContext} />
      <CommandResultModal
        payload={commandModalPayload}
        onClose={closeCommandModal}
        providerModelCatalog={providerModelCatalog}
        providerModelActions={providerModelActions}
        activeProvider={provider}
        activeProviderModel={currentProviderModel}
        currentSessionId={currentSessionId || selectedSession?.id || null}
        onSelectProviderModel={selectProviderModel}
      />
    </PermissionContext.Provider>
  );
}

export default React.memo(ChatInterface);

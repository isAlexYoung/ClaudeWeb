import { useTranslation } from 'react-i18next';
import { memo, useCallback, useMemo } from 'react';
import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react';

import type {
  BackgroundTaskSummary,
  ChatMessage,
  Project,
  ProjectSession,
  LLMProvider,
  ProviderModelActions,
  ProviderModelsDefinition,
  SessionActivity,
  TurnChanges } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import { groupConsecutiveTools, isToolGroupItem } from '@/modules/chat/utils/toolGrouping';
import { findRegenerateTarget } from '@/modules/chat/utils/regenerateTarget';
import { collectTurnChanges } from '@/modules/chat/utils/turnChanges';
import ChangeSummaryCard from '@/modules/chat/transcript/ChangeSummaryCard';
import { useLazyRowObserver } from '@/modules/chat/hooks/useLazyRowObserver';
import LazyMessageRow from '@/modules/chat/transcript/LazyMessageRow';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import ProviderSelectionEmptyState from '@/modules/chat/transcript/ProviderSelectionEmptyState';
import ToolGroupContainer from '@/modules/chat/transcript/ToolGroupContainer';
import ActivityIndicator from '@/modules/chat/transcript/ActivityIndicator';
import LoadAllMessagesOverlay from '@/modules/chat/transcript/LoadAllMessagesOverlay';
import ChatExportMenu from '@/modules/chat/transcript/ChatExportMenu';
import { useTranscriptActionsRegistration } from '@/modules/chat/hooks/useTranscriptActionsRegistration';
import { BackgroundTasksStrip } from '@/modules/chat/transcript/BackgroundTasksStrip';
import { assistantResponseTurns } from '@/modules/chat/utils/assistantResponseTurns';
import { AssistantReplyActions } from '@/modules/chat/transcript/AssistantReplyActions';
import { ResponseProcess } from '@/modules/chat/transcript/ResponseProcess';

/**
 * How many of the newest rows mount with real content on the first commit,
 * before the lazy-row observer has had a chance to report what is actually
 * near the viewport. Covers a bit more than one screen of typical rows.
 */
const INITIAL_MOUNTED_TAIL_ROWS = 30;

type ChatMessagesPaneProps = {
  hideEmptyState?: boolean;
  scrollContainerRef: RefObject<HTMLDivElement>;
  onWheel: () => void;
  onTouchMove: () => void;
  isLoadingSessionMessages: boolean;
  /** True while the viewed session has an active provider run in flight. */
  isProcessing?: boolean;
  /** The viewed session's in-flight response or background work, shown as the transcript's last line. */
  activity?: SessionActivity | null;
  chatMessages: ChatMessage[];
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (provider: LLMProvider) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  providerModels: Record<LLMProvider, string>;
  setProviderModel: (provider: LLMProvider, model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: Dispatch<SetStateAction<string>>;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  totalMessages: number;
  sessionMessagesCount: number;
  visibleMessageCount: number;
  visibleMessages: ChatMessage[];
  loadEarlierMessages: () => void;
  revealMessage: (message: ChatMessage) => void;
  /** The session's running background tasks from the activity map, for the strip to list ones whose rows are not loaded. */
  backgroundTasks?: BackgroundTaskSummary[];
  /** The chat websocket's send, which the background-tasks strip stops a task over. */
  sendMessage: (message: unknown) => void;
  loadAllMessages: () => void;
  allMessagesLoaded: boolean;
  isLoadingAllMessages: boolean;
  loadAllJustFinished: boolean;
  showLoadAllOverlay: boolean;
  createDiff: any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject: Project;
  /** Loads an already-sent message back into the composer; absent when the provider cannot re-run from a point. */
  onEditMessage?: (message: ChatMessage) => void;
  /** Branches the conversation into a new session ending at a message. */
  onForkFromMessage?: (message: ChatMessage) => void;
  /** Runs a user message again as it was sent; offered under the reply that ends the conversation. */
  onRegenerateMessage?: (message: ChatMessage) => void;
  /** Draws the change summary card after each turn that edited files. */
  showChangeSummary?: boolean;
  /** Opens the right panel's Changes view from a card's file row. */
  onOpenChanges?: (changes: TurnChanges, path: string) => void;
  /** Optional card pinned to the top of the transcript column (e.g. a minimized artefact). */
  transcriptHeader?: ReactNode;
  /** Fetches the whole transcript for an export, which otherwise only sees the loaded page. */
  onLoadFullTranscript?: () => Promise<ChatMessage[]>;
};

/**
 * Keys for the rows inside a collapsed tool group. They only have to be unique
 * among that group's own rows (ToolGroupContainer disambiguates repeats), so
 * they do not depend on the pane's per-render key map — and being a module
 * function, the prop keeps its identity, which is what lets
 * memo(ToolGroupContainer) skip a group on a stream tick that did not touch it.
 */
const getGroupedMessageKey = (message: ChatMessage): string =>
  getIntrinsicMessageKey(message) ?? 'message-generated';

/**
 * Rendered by chat's ChatInterface as the scrolling transcript: the message
 * list and tool groups, the export menu, the provider empty state and the
 * load-all-history overlay.
 */
function ChatMessagesPane({
  scrollContainerRef,
  onWheel,
  onTouchMove,
  isLoadingSessionMessages,
  isProcessing = false,
  activity = null,
  chatMessages,
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  providerModels,
  setProviderModel,
  providerModelCatalog,
  providerModelActions,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
  isLoadingMoreMessages,
  hasMoreMessages,
  totalMessages,
  sessionMessagesCount,
  visibleMessageCount,
  visibleMessages,
  loadEarlierMessages,
  revealMessage,
  backgroundTasks,
  sendMessage,
  loadAllMessages,
  allMessagesLoaded,
  isLoadingAllMessages,
  loadAllJustFinished,
  showLoadAllOverlay,
  createDiff,
  onEditMessage,
  onForkFromMessage,
  onRegenerateMessage,
  showChangeSummary = false,
  onOpenChanges,
  transcriptHeader,
  onLoadFullTranscript,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  selectedProject,
  hideEmptyState = false,
}: ChatMessagesPaneProps) {
  const { t } = useTranslation('chat');
  const lazyRows = useLazyRowObserver(scrollContainerRef);
  // Inside the integrated workspace, copy and export move to the header's More menu.
  const exportsFromWorkspaceHeader = useTranscriptActionsRegistration({
    messages: chatMessages,
    sessionTitle: String(selectedSession?.summary || selectedSession?.title || '').trim() || t('export.untitled'),
    provider,
    selectedProject,
    createDiff,
    onLoadFullTranscript,
  });
  // Regenerate sits under the reply that ends the conversation: the last
  // assistant text after the last user message, when that message can be re-run.
  const regenerateTarget = useMemo(
    () => (onRegenerateMessage ? findRegenerateTarget(visibleMessages) : null),
    [onRegenerateMessage, visibleMessages],
  );

  // What each finished turn changed, keyed by the turn's last message; the
  // running turn gets its card once it ends.
  const turnChanges = useMemo(
    () => (showChangeSummary ? collectTurnChanges(visibleMessages, createDiff, Boolean(activity)) : null),
    [showChangeSummary, visibleMessages, createDiff, activity],
  );
  const projectRoot = selectedProject?.fullPath || selectedProject?.path;
  const renderChangeCard = (message: ChatMessage | undefined) => {
    const changes = message ? turnChanges?.get(message) : undefined;
    return changes ? <ChangeSummaryCard changes={changes} projectRoot={projectRoot} onOpenFile={onOpenChanges} /> : null;
  };

  const responseTurns = useMemo(
    () => assistantResponseTurns(visibleMessages, Boolean(showThinking)),
    [visibleMessages, showThinking],
  );
  const visiblePositions = useMemo(() => new WeakMap(visibleMessages.map((message, index) => [message, index] as const)), [visibleMessages]);

  // Stable, deterministic keys for the messages rendered this pass.
  //
  // A server refresh can replace source records with equivalent new objects, so
  // object identity is not a durable React key across pagination or hydration.
  // Deriving keys from this render's ordered messages (intrinsic key,
  // disambiguated by occurrence index on collision) preserves existing DOM
  // nodes and component state when older history is prepended.
  const messageKeyMap = useMemo(() => {
    const keys = new WeakMap<ChatMessage, string>();
    const occurrences = new Map<string, number>();
    const assign = (message: ChatMessage) => {
      const intrinsicKey = getIntrinsicMessageKey(message) ?? 'message-generated';
      const seen = occurrences.get(intrinsicKey) ?? 0;
      occurrences.set(intrinsicKey, seen + 1);
      keys.set(message, seen === 0 ? intrinsicKey : `${intrinsicKey}__${seen}`);
    };
    // Use the full loaded list so duplicate keys stay identical to the navigation rail as the window widens.
    chatMessages.forEach(assign);
    return keys;
  }, [chatMessages]);

  const getMessageKey = useCallback(
    (message: ChatMessage) =>
      messageKeyMap.get(message) ?? getIntrinsicMessageKey(message) ?? 'message-generated',
    [messageKeyMap],
  );

  return (
    <div
      ref={scrollContainerRef}
      onWheel={onWheel}
      onTouchMove={onTouchMove}
      onPointerMove={event => {
        const pane = event.currentTarget;
        pane.dataset.scrollbarVisible = String(pane.getBoundingClientRect().right - event.clientX <= 18);
      }}
      onPointerLeave={event => { delete event.currentTarget.dataset.scrollbarVisible; }}
      className="chat-messages-pane relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 pt-3 sm:pb-4 sm:pt-4"
    >
      {chatMessages.length > 0 && (
        <div className="pointer-events-none sticky right-4 top-3 z-10 mb-2 flex items-start justify-between gap-2 sm:px-4">
          {/* Running background work stays in view while the transcript scrolls under it. */}
          <div className="pointer-events-auto min-w-0 pl-4 sm:pl-0">
            <BackgroundTasksStrip
              messages={chatMessages}
              tasks={backgroundTasks}
              sessionId={selectedSession?.id || currentSessionId}
              sendMessage={sendMessage}
              onReveal={revealMessage}
              onLoadAll={loadAllMessages}
            />
          </div>
          {!exportsFromWorkspaceHeader && (
            <div className="pointer-events-auto">
              <ChatExportMenu
                messages={chatMessages}
                sessionTitle={selectedSession?.summary || selectedSession?.title}
                provider={provider}
                selectedProject={selectedProject}
                createDiff={createDiff}
                onLoadFullTranscript={onLoadFullTranscript}
              />
            </div>
          )}
        </div>
      )}
      <div className="mx-auto w-full max-w-[54.25rem] space-y-3 px-4 sm:space-y-4">
      {transcriptHeader}
      {(isLoadingSessionMessages || isProcessing) && chatMessages.length === 0 ? (
        <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
          <div className="flex items-center justify-center space-x-2">
            <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
            <p>{t('session.loading.sessionMessages')}</p>
          </div>
        </div>
      ) : chatMessages.length === 0 ? (hideEmptyState ? null :
        <ProviderSelectionEmptyState
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={provider}
          setProvider={setProvider}
          textareaRef={textareaRef}
          providerModels={providerModels}
          setProviderModel={setProviderModel}
          providerModelCatalog={providerModelCatalog}
          providerModelActions={providerModelActions}
          providerModelsLoading={providerModelsLoading}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
        />
      ) : (
        <>
          {/* Loading indicator for older messages (hide when load-all is active) */}
          {isLoadingMoreMessages && !isLoadingAllMessages && !allMessagesLoaded && (
            <div className="py-3 text-center text-gray-500 dark:text-gray-400">
              <div className="flex items-center justify-center space-x-2">
                <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-gray-400" />
                <p className="text-sm">{t('session.loading.olderMessages')}</p>
              </div>
            </div>
          )}

          {/* Indicator showing there are more messages to load (hide when all loaded) */}
          {hasMoreMessages && !isLoadingMoreMessages && !allMessagesLoaded && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {totalMessages > 0 && (
                <span>
                  {t('session.messages.showingOf', { shown: sessionMessagesCount, total: totalMessages })}{' '}
                  <span className="text-xs">{t('session.messages.scrollToLoad')}</span>
                </span>
              )}
            </div>
          )}

          <LoadAllMessagesOverlay
            showLoadAllOverlay={showLoadAllOverlay}
            isLoadingAllMessages={isLoadingAllMessages}
            loadAllJustFinished={loadAllJustFinished}
            totalMessages={totalMessages}
            onLoadAllMessages={loadAllMessages}
          />

          {/* Legacy message count indicator (for non-paginated view) */}
          {!hasMoreMessages && chatMessages.length > visibleMessageCount && (
            <div className="border-b border-gray-200 py-2 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('session.messages.showingLast', { count: visibleMessageCount, total: chatMessages.length })} |
              <button className="ml-1 text-blue-600 underline hover:text-blue-700" onClick={loadEarlierMessages}>
                {t('session.messages.loadEarlier')}
              </button>
              {' | '}
              <button
                className="text-blue-600 underline hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                onClick={loadAllMessages}
              >
                {t('session.messages.loadAll')}
              </button>
            </div>
          )}

          {responseTurns.map((turn, turnIndex) => {
            const running = isProcessing && turnIndex === responseTurns.length - 1;
            const renderMessages = (messages: ChatMessage[], previous: ChatMessage | null = null) => {
              let prevMessage: ChatMessage | null = previous;

              return groupConsecutiveTools(messages, Boolean(showThinking)).map((item) => {
                // Rows near the tail mount their content on first commit so the
                // initial scroll-to-bottom measures real heights; older rows
                // start as placeholders and mount when scrolled toward.
                const rowMessage = isToolGroupItem(item) ? item.messages[item.messages.length - 1] : item;
                const initiallyNearViewport = (visiblePositions.get(rowMessage) ?? 0) >= visibleMessages.length - INITIAL_MOUNTED_TAIL_ROWS;

                if (isToolGroupItem(item)) {
                  const groupPrevMessage = prevMessage;
                  prevMessage = item.messages[item.messages.length - 1] || prevMessage;

                  return (
                    <LazyMessageRow
                      key={`tool-group-${getMessageKey(item.messages[0])}`}
                      sourceMessageKeys={item.messages.map(getMessageKey)}
                      lazyRows={lazyRows}
                      timestamp={item.timestamp}
                      initiallyNearViewport={initiallyNearViewport}
                    >
                      <ToolGroupContainer
                        group={item}
                        prevMessage={groupPrevMessage}
                        createDiff={createDiff}
                        getMessageKey={getGroupedMessageKey}
                        onFileOpen={onFileOpen}
                        onShowSettings={onShowSettings}
                        onGrantToolPermission={onGrantToolPermission}
                        showRawParameters={showRawParameters}
                        showThinking={showThinking}
                        hideAssistantActions
                        selectedProject={selectedProject}
                        provider={provider}
                      />
                    </LazyMessageRow>
                  );
                }

                const messagePrevMessage = prevMessage;
                prevMessage = item;

                return (
                  <LazyMessageRow
                    key={getMessageKey(item) + (item.isThinking ? ':thinking' : '')}
                    sourceMessageKey={getMessageKey(item)}
                    sourceKind={item.isThinking ? 'thinking' : 'text'}
                    lazyRows={lazyRows}
                    userTurnKey={item.type === 'user' ? getMessageKey(item) : undefined}
                    timestamp={item.timestamp}
                    initiallyNearViewport={initiallyNearViewport}
                  >
                    <MessageComponent
                      message={item}
                      prevMessage={messagePrevMessage}
                      createDiff={createDiff}
                      onFileOpen={onFileOpen}
                      onShowSettings={onShowSettings}
                      onGrantToolPermission={onGrantToolPermission}
                      showRawParameters={showRawParameters}
                      showThinking={Boolean(showThinking) && !item.reasoning}
                      hideAssistantActions={item.type !== 'user'}
                      selectedProject={selectedProject}
                      provider={provider}
                      onEditMessage={onEditMessage}
                      onForkFromMessage={onForkFromMessage}
                    />
                  </LazyMessageRow>
                );
              });
            };
            const last = turn.messages[turn.messages.length - 1];
            return <section key={`${selectedSession?.id || currentSessionId}:${turn.key}`} className="workspace-response-turn space-y-3">
              {turn.user && renderMessages([turn.user])}
              {turn.process.length > 0 && <ResponseProcess running={running}>{renderMessages(turn.process, turn.user || null)}</ResponseProcess>}
              {renderMessages(turn.answer, turn.process[turn.process.length - 1] || turn.user || null)}
              {!running && last && <AssistantReplyActions message={last} content={turn.copyContent} model={turn.model}
                regenerateFrom={regenerateTarget && turn.messages.includes(regenerateTarget.reply) ? regenerateTarget.from : undefined} onRegenerateMessage={onRegenerateMessage} />}
              {renderChangeCard(last)}
            </section>;
          })}

          <ActivityIndicator activity={activity} />
        </>
      )}
      </div>
    </div>
  );
}

export default memo(ChatMessagesPane);

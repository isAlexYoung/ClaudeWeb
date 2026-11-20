import { memo, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranchIcon, PencilIcon } from 'lucide-react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, LLMProvider,DiffLine,Project } from '@/shared/types';
import { formatUsageLimitText } from '@/modules/chat/utils/chatFormatting';
import { ToolRenderer, ToolErrorDisplay, SubagentPanel, WorkflowPanel, shouldHideToolResult } from '@/modules/chat/tools';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/modules/chat/transcript/Reasoning';
import ChatMessageImages from '@/modules/chat/transcript/ChatMessageImages';
import ChatMessageFiles from '@/modules/chat/transcript/ChatMessageFiles';
import GeneratedFileCard from '@/modules/chat/transcript/GeneratedFileCard';
import { isGeneratedFilePath, parseQuotedQuestion } from '@/shared/utils';
import { SentQuoteChips } from '@/modules/side-chat';
import { useTranscriptSessionId } from '@/modules/chat/context/TranscriptSessionContext';
import { Markdown } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
import MessageCopyControl from '@/modules/chat/transcript/MessageCopyControl';
import { AssistantReplyActions } from '@/modules/chat/transcript/AssistantReplyActions';
import MessageTime from '@/modules/chat/transcript/MessageTime';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';
import { MemoryCitations } from '@/modules/chat/transcript/MemoryCitations';

type MessageComponentProps = {
  message: ChatMessage;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  /** The pane renders one footer for the whole response, including tool-separated chunks. */
  hideAssistantActions?: boolean;
  selectedProject?: Project | null;
  provider: LLMProvider | string;
  /**
   * Loads this message back into the composer to be replaced. Absent when the
   * provider cannot re-run a conversation from a chosen point, which is what
   * hides the affordance rather than showing one that would fail.
   */
  onEditMessage?: (message: ChatMessage) => void;
  /**
   * Branches the conversation into a new session ending at this message.
   * Absent when the provider cannot copy a transcript prefix.
   */
  onForkFromMessage?: (message: ChatMessage) => void;
  /** Set on the reply that ends the conversation: the user message Regenerate runs again. */
  regenerateFrom?: ChatMessage;
  onRegenerateMessage?: (message: ChatMessage) => void;
};

const COPY_HIDDEN_TOOL_NAMES = new Set(['Bash', 'Edit', 'Write', 'ApplyPatch']);

/**
 * Rendered by chat's ChatMessagesPane and ToolGroupContainer to draw one
 * transcript entry — user turn, assistant turn, or a tool call and its result.
 */
const MessageComponent = memo(({ message, prevMessage, createDiff, onFileOpen, showRawParameters, showThinking, hideAssistantActions = false, selectedProject, provider, onEditMessage, onForkFromMessage, regenerateFrom, onRegenerateMessage }: MessageComponentProps) => {
  const { t } = useTranslation('chat');
  const isGrouped = prevMessage && prevMessage.type === message.type &&
    ((prevMessage.type === 'assistant') ||
      (prevMessage.type === 'user') ||
      (prevMessage.type === 'tool') ||
      (prevMessage.type === 'error'));
  const messageRef = useRef<HTMLDivElement | null>(null);
  const rawUserContent = String(message.content || '');
  const sessionId = useTranscriptSessionId();
  const userQuestion = useMemo(() => message.type === 'user' ? parseQuotedQuestion(rawUserContent) : { input: rawUserContent, quotes: [] }, [message.type, rawUserContent]);
  const userCopyContent = [...userQuestion.quotes.map(quote => quote.text), userQuestion.input].filter(Boolean).join('\n\n');
  const formattedMessageContent = useMemo(
    () => formatUsageLimitText(String(message.content || '')),
    [message.content]
  );
  const assistantCopyContent = message.isToolUse
    ? String(message.displayText || message.content || '')
    : formattedMessageContent;
  const isCommandOrFileEditToolResponse = Boolean(
    message.isToolUse && COPY_HIDDEN_TOOL_NAMES.has(String(message.toolName || ''))
  );
  // Copy is an affordance for a live conversation. In an exported document
  // there is nothing to click.
  const isExporting = useIsExportingTranscript();
  const shouldShowUserCopyControl = !isExporting && message.type === 'user' && userCopyContent.trim().length > 0;
  const shouldShowAssistantCopyControl = !isExporting &&
    message.type === 'assistant' &&
    assistantCopyContent.trim().length > 0 &&
    !isCommandOrFileEditToolResponse &&
    !message.isThinking;


  const generatedPath = useMemo(() => {
    if (!message.isToolUse || !['Write', 'Edit'].includes(message.toolName || '') || !message.toolResult || message.toolResult.isError) return null;
    try {
      const input = typeof message.toolInput === 'string' ? JSON.parse(message.toolInput) : message.toolInput;
      const path = input?.file_path;
      return typeof path === 'string' && isGeneratedFilePath(path) ? path : null;
    } catch { return null; }
  }, [message.isToolUse, message.toolName, message.toolInput, message.toolResult]);
  const shouldHideThinkingMessage = Boolean(message.isThinking && !showThinking);

  if (shouldHideThinkingMessage) {
    return null;
  }

  return (
    <div
      ref={messageRef}
      data-selection-message={isExporting ? undefined : "true"}
      data-source-message-key={isExporting ? undefined : getIntrinsicMessageKey(message) || undefined}
      data-source-role={isExporting ? undefined : message.type}
      data-source-kind={isExporting ? undefined : message.isThinking ? 'thinking' : 'text'}
      data-message-timestamp={message.timestamp || undefined}
      className={`chat-message ${message.type} ${isGrouped ? 'grouped' : ''} ${message.type === 'user' ? 'flex justify-end px-3 sm:px-0' : 'px-3 sm:px-0'}`}
    >
      {message.type === 'user' ? (
        /* User turn on the right: claude.ai-style attachment cards above the bubble */
        <div className="flex w-full items-end space-x-0 sm:w-auto sm:max-w-[85%] sm:space-x-3 md:max-w-md lg:max-w-lg xl:max-w-xl">
          <div className="flex min-w-0 flex-1 flex-col items-end gap-2 sm:flex-initial">
            {message.images && message.images.length > 0 && (
              <ChatMessageImages
                images={message.images}
                projectId={selectedProject?.projectId}
              />
            )}
            {message.files && message.files.length > 0 && (
              <ChatMessageFiles files={message.files} />
            )}
            {userQuestion.quotes.length > 0 && <SentQuoteChips quotes={userQuestion.quotes} sessionId={sessionId} isExporting={isExporting} />}
            {userCopyContent.trim().length > 0 || (!message.images?.length && !message.files?.length) ? (
              <>
              <div className="workspace-user-bubble group max-w-full rounded-2xl rounded-br-md border border-border/60 bg-muted/60 px-3 py-2 text-foreground shadow-sm dark:bg-gray-800/60 sm:px-4">
                <div dir="auto" className="break-words font-serif text-sm">
                  <Markdown
                    breaks
                    className="prose prose-sm max-w-none font-serif dark:prose-invert"
                  >
                    {userQuestion.input}
                  </Markdown>
                </div>
              </div>
                {/* Shown while the pointer is over the message (see workspace-theme.css). */}
                <div className="workspace-user-actions flex items-center justify-end gap-2 text-xs text-muted-foreground">
                  <MessageTime timestamp={message.timestamp} exact={isExporting} />
                  {shouldShowUserCopyControl && <MessageCopyControl content={userCopyContent} messageType="user" />}
                  {onEditMessage && message.transcriptAnchorId && (
                    <button
                      type="button"
                      onClick={() => onEditMessage(message)}
                      title={t('message.editAndResend')}
                      aria-label={t('message.editAndResend')}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {onForkFromMessage && message.transcriptAnchorId && (
                    <button
                      type="button"
                      onClick={() => onForkFromMessage(message)}
                      title={t('message.forkFromHere')}
                      aria-label={t('message.forkFromHere')}
                      className="rounded p-1 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <GitBranchIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </>
            ) : (
              /* Attachment-only turn: no text bubble, but the timestamp still shows */
              <div className="workspace-user-actions flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <MessageTime timestamp={message.timestamp} exact={isExporting} />
              </div>
            )}
          </div>

        </div>
      ) : message.compact ? (
        /* A compaction: one row, its numbers, and its summary folded into it */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span
              className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                message.compact.phase === 'running'
                  ? 'animate-pulse bg-amber-400 dark:bg-amber-500'
                  : message.compact.phase === 'failed'
                    ? 'bg-red-400 dark:bg-red-500'
                    : 'bg-gray-400 dark:bg-gray-500'
              }`}
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {message.content || t('chat:misc.compacted', 'Compacted')}
            </span>
          </div>
          {message.compactSummary && (
            <details className="ml-3.5 mt-0.5">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-foreground dark:text-gray-400">
                {t('chat:misc.compactionSummary', 'full summary')}
              </summary>
              <div className="mt-1">
                <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                  {message.compactSummary}
                </Markdown>
              </div>
            </details>
          )}
        </div>
      ) : message.isTaskNotification ? (
        /* Compact task notification on the left */
        <div className="w-full">
          <div className="flex items-center gap-2 py-0.5">
            <span className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${message.taskNotificationStatus === 'completed' ? 'bg-green-400 dark:bg-green-500' : 'bg-amber-400 dark:bg-amber-500'}`} />
            <span className="text-xs text-gray-500 dark:text-gray-400">{message.content}</span>
          </div>
        </div>
      ) : (
        /* Claude/Error/Tool messages on the left */
        <div className="w-full">


          <div className="w-full">

            {message.isToolUse && message.toolName === 'Workflow' ? (
              /* A workflow launch owns its whole card too. The anchor is what
                 the background-tasks strip scrolls to. */
              <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                <WorkflowPanel
                  toolInput={message.toolInput}
                  toolResult={message.toolResult}
                  workflow={message.workflow}
                  taskStatus={message.taskStatus}
                  onFileOpen={onFileOpen}
                  createDiff={createDiff}
                  selectedProject={selectedProject}
                />
              </div>
            ) : message.isSubagentContainer ? (
              /* A spawned agent owns its whole card — header, timeline and
                 result — so it never goes through the tool input/result pair. */
              <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                <SubagentPanel
                  toolInput={message.toolInput}
                  toolResult={message.toolResult}
                  subagent={message.subagent}
                  taskStatus={message.taskStatus}
                  activity={message.subagentActivity}
                  onFileOpen={onFileOpen}
                  createDiff={createDiff}
                  selectedProject={selectedProject}
                />
              </div>
            ) : message.isToolUse ? (
              <>
                <div className="flex flex-col">
                  <div className="flex flex-col">
                    <Markdown className="prose prose-sm max-w-none font-serif dark:prose-invert">
                      {String(message.displayText || '')}
                    </Markdown>
                  </div>
                </div>

                {message.toolInput && (
                  // Bash draws its output inside this row rather than in the
                  // result section below, so for a backgrounded command this is
                  // the row the background-tasks strip scrolls to.
                  <div id={message.toolName === 'Bash' ? `tool-result-${message.toolId}` : undefined} className="scroll-mt-4">
                    <ToolRenderer
                      toolName={message.toolName || 'UnknownTool'}
                      toolInput={message.toolInput}
                      toolResult={message.toolResult}
                      toolId={message.toolId}
                      mode="input"
                      onFileOpen={onFileOpen}
                      createDiff={createDiff}
                      selectedProject={selectedProject}
                      showRawParameters={showRawParameters}
                      rawToolInput={typeof message.toolInput === 'string' ? message.toolInput : undefined}
                      toolStatus={message.toolStatus}
                    />
                  </div>
                )}

                {/* Tool Result Section — Bash renders its output inside the command row above. */}
                {generatedPath && <GeneratedFileCard path={generatedPath} />}
                {message.toolResult && message.toolName !== 'Bash' && !shouldHideToolResult(message.toolName || 'UnknownTool', message.toolResult) && (
                  message.toolResult.isError ? (
                    // Error results — collapsed red row that expands to the content
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolErrorDisplay
                        label={t('messageTypes.error')}
                        content={String(message.toolResult.content || '')}
                      />
                    </div>
                  ) : (
                    // Non-error results - route through ToolRenderer (single source of truth)
                    <div id={`tool-result-${message.toolId}`} className="scroll-mt-4">
                      <ToolRenderer
                        toolName={message.toolName || 'UnknownTool'}
                        toolInput={message.toolInput}
                        toolResult={message.toolResult}
                        toolId={message.toolId}
                        mode="result"
                        onFileOpen={onFileOpen}
                        createDiff={createDiff}
                        selectedProject={selectedProject}
                      />
                    </div>
                  )
                )}
              </>
            ) : message.isThinking ? (
              /* Thinking messages — Reasoning component (ai-elements pattern) */
              <Reasoning defaultOpen={isExporting || hideAssistantActions}>
                <ReasoningTrigger />
                <ReasoningContent data-quote-kind="thinking">
                  <Markdown className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert">
                    {message.content}
                  </Markdown>
                  {!isExporting && !hideAssistantActions && (
                    <div className="mt-3 flex items-center text-[11px]">
                      <MessageCopyControl content={String(message.content || '')} messageType="assistant" />
                    </div>
                  )}
                </ReasoningContent>
              </Reasoning>
            ) : (
              <div dir="auto" className="text-sm text-gray-700 dark:text-gray-300">
                {/* Reasoning accordion */}
                {showThinking && message.reasoning && (
                  <Reasoning className="mb-3" defaultOpen={false}>
                    <ReasoningTrigger />
                    <ReasoningContent data-quote-kind="thinking">
                      <div className="whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </ReasoningContent>
                  </Reasoning>
                )}

                {(() => {
                  const content = formattedMessageContent;

                  // Detect if content is pure JSON (starts with { or [)
                  const trimmedContent = content.trim();
                  if ((trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) &&
                    (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))) {
                    try {
                      const parsed = JSON.parse(trimmedContent);
                      const formatted = JSON.stringify(parsed, null, 2);

                      return (
                        <div className="my-2">
                          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            <span className="font-medium">{t('json.response')}</span>
                          </div>
                          <div className="overflow-hidden rounded-lg border border-border bg-muted">
                            <pre className="overflow-x-auto p-4">
                              <code className="block whitespace-pre font-mono text-sm text-foreground">
                                {formatted}
                              </code>
                            </pre>
                          </div>
                        </div>
                      );
                    } catch {
                      // Not valid JSON, fall through to normal rendering
                    }
                  }

                  // Normal rendering for non-JSON content
                  // One component for both states on purpose: swapping element
                  // types here remounted the whole reply the instant it finished.
                  return message.type === 'assistant' ? (
                    <StreamingMarkdown
                      content={content}
                      isStreaming={Boolean(message.isStreaming)}
                      className="prose prose-sm prose-gray max-w-none font-serif dark:prose-invert"
                    />
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {content}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Outside the branches on purpose: a provider can cite memory on a
                plain reply or on the plan card it turned that reply into. */}
            {Array.isArray(message.memoryCitations) && message.memoryCitations.length > 0 && (
              <MemoryCitations citations={message.memoryCitations} />
            )}

            {!hideAssistantActions && (shouldShowAssistantCopyControl || !isGrouped) && (
              <AssistantReplyActions message={message} content={assistantCopyContent} canCopy={shouldShowAssistantCopyControl} isExporting={isExporting} regenerateFrom={regenerateFrom} onRegenerateMessage={onRegenerateMessage} />
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default MessageComponent;


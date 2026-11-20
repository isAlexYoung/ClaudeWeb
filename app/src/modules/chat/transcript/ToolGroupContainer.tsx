import { memo, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';

import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult, LLMProvider,DiffLine,DiffStats,Project,ToolGroupItem } from '@/shared/types';
import { getToolConfig } from '@/modules/chat/tools';
import MessageComponent from '@/modules/chat/transcript/MessageComponent';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';
import { DiffStatsBadge } from '@/modules/chat/tools/DiffStatsBadge';
import { describeToolCall } from '@/modules/chat/utils/toolGrouping';
import { parseToolPayload, summarizeDiff } from '@/modules/chat/utils/messageTransforms';

type ToolGroupContainerProps = {
  group: ToolGroupItem;
  prevMessage: ChatMessage | null;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  getMessageKey: (message: ChatMessage) => string;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  showRawParameters?: boolean;
  showThinking?: boolean;
  hideAssistantActions?: boolean;
  selectedProject?: Project | null;
  provider: LLMProvider | string;
};

/** Lines a set of file edits added and removed, or null when none of them renders a diff. */
function totalDiffStats(
  messages: ChatMessage[],
  createDiff: (oldStr: string, newStr: string) => DiffLine[],
): DiffStats | null {
  let added = 0;
  let removed = 0;
  let counted = 0;

  for (const message of messages) {
    if (!message.isToolUse || !message.toolName) continue;
    const config = getToolConfig(message.toolName).input;
    if (config.contentType !== 'diff' || !config.getContentProps) continue;

    const contentProps = config.getContentProps(parseToolPayload(message.toolInput) ?? {});
    if (typeof contentProps?.oldContent !== 'string' || typeof contentProps?.newContent !== 'string') {
      continue;
    }

    const stats = summarizeDiff(createDiff(contentProps.oldContent, contentProps.newContent));
    added += stats.added;
    removed += stats.removed;
    counted += 1;
  }

  return counted > 0 ? { added, removed } : null;
}

const ROW_CLASS = 'group flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground';

type ToolCallRowProps = {
  message: ChatMessage;
  preview: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  children: ReactNode;
};

/**
 * One call as one line — `windows-pc-files：Edit File  a.cjs` — that opens to
 * the call's full card. Closed on screen, open in an export, which has no way
 * to ask for detail.
 */
function ToolCallRow({ message, preview, createDiff, children }: ToolCallRowProps) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  const [isOpen, setIsOpen] = useState(false);
  const showDetail = isOpen || isExporting;
  const { source, action } = describeToolCall(message.toolName || '');
  const label = action ? t('toolGroup.callLabel', { source, action }) : source;
  const failed = message.toolResult?.isError === true;
  const diffStats = useMemo(() => totalDiffStats([message], createDiff), [message, createDiff]);

  return (
    <div>
      <button type="button" className={ROW_CLASS} onClick={() => setIsOpen((current) => !current)} aria-expanded={showDetail}>
        <ChevronRight
          className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${showDetail ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className="flex-shrink-0">{label}</span>
        {preview && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground/80">{preview}</span>}
        {failed && <span className="flex-shrink-0 text-xs text-destructive">{t('toolGroup.callFailed')}</span>}
        {diffStats && <DiffStatsBadge stats={diffStats} className="ml-auto pl-2" />}
      </button>
      {showDetail && <div className="mb-2 mt-1">{children}</div>}
    </div>
  );
}

/**
 * Rendered by chat's ChatMessagesPane (and the transcript export) for a run of
 * consecutive tool calls: one line saying who was called how often and how
 * many calls failed, which opens to a line per call. A run of one call is just
 * that call's line.
 */
function ToolGroupContainer({
  group,
  prevMessage,
  createDiff,
  getMessageKey,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  showRawParameters,
  showThinking,
  hideAssistantActions,
  selectedProject,
  provider,
}: ToolGroupContainerProps) {
  const { t } = useTranslation('chat');
  const isExporting = useIsExportingTranscript();
  const [isExpanded, setIsExpanded] = useState(false);
  const showChildren = isExpanded || isExporting;
  const groupDiffStats = useMemo(() => totalDiffStats(group.messages, createDiff), [group.messages, createDiff]);

  // Keys only have to be unique among this group's own rows, so repeats of the
  // same key are disambiguated here by occurrence.
  const messageKeys = useMemo(() => {
    const occurrences = new Map<string, number>();
    return group.messages.map((message) => {
      const key = getMessageKey(message);
      const seen = occurrences.get(key) ?? 0;
      occurrences.set(key, seen + 1);
      return seen === 0 ? key : `${key}__${seen}`;
    });
  }, [group.messages, getMessageKey]);

  const renderRow = (message: ChatMessage, index: number) => {
    const detail = (
      <MessageComponent
        message={message}
        prevMessage={index > 0 ? group.messages[index - 1] : prevMessage}
        createDiff={createDiff}
        onFileOpen={onFileOpen}
        onShowSettings={onShowSettings}
        onGrantToolPermission={onGrantToolPermission}
        showRawParameters={showRawParameters}
        showThinking={showThinking}
        hideAssistantActions={hideAssistantActions}
        selectedProject={selectedProject}
        provider={provider}
      />
    );

    // Reasoning between two calls keeps its own collapsed "Thinking" block.
    if (!message.isToolUse) {
      return <div key={messageKeys[index]}>{detail}</div>;
    }

    return (
      <ToolCallRow
        key={messageKeys[index]}
        message={message}
        preview={group.callPreviews[index] ?? ''}
        createDiff={createDiff}
      >
        {detail}
      </ToolCallRow>
    );
  };

  if (group.messages.length === 1) {
    return (
      <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={group.timestamp || undefined}>
        {renderRow(group.messages[0], 0)}
      </div>
    );
  }

  const summary = group.sourceName
    ? t('toolGroup.usedSource', { name: group.sourceName, count: group.toolCount })
    : t('toolGroup.usedTools', { count: group.toolCount });

  return (
    <div className="chat-message tool px-3 sm:px-0" data-message-timestamp={group.timestamp || undefined}>
      <button
        type="button"
        className={ROW_CLASS}
        onClick={() => setIsExpanded((current) => !current)}
        aria-expanded={showChildren}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${showChildren ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className="min-w-0 truncate">
          {summary}
          {group.failedCount > 0 && t('toolGroup.failed', { count: group.failedCount })}
        </span>
        {groupDiffStats && <DiffStatsBadge stats={groupDiffStats} className="ml-auto pl-2" />}
      </button>

      {showChildren && (
        <div className="ml-[0.6rem] mt-1 space-y-0.5 border-l border-border/60 pl-3">
          {group.messages.map(renderRow)}
        </div>
      )}
    </div>
  );
}

/**
 * Memoized for the transcript re-renders that are not message changes — the
 * pane re-renders when isProcessing or the activity line flips, and on every
 * 100ms stream tick, and the group is unchanged then.
 *
 * Bailing out depends on two identities the pane keeps stable on its side:
 * `group`, which groupConsecutiveTools reuses while the run's rows are
 * unchanged, and `getMessageKey`, a module-level function. Adding a prop
 * rebuilt per render here would cost every group on screen a render per tick.
 */
export default memo(ToolGroupContainer);

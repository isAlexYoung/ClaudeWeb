import type { ChatMessage, ToolGroupItem } from '@/shared/types';
import { formatToolDisplayName, getToolConfig } from '@/modules/chat/tools/configs/toolConfigs';

/** A single call is a group too, so every tool call reads as one line until expanded. */
export const TOOL_GROUP_THRESHOLD = 1;

/** How many of a group's tool inputs the collapsed summary line spells out. */
const PREVIEWED_TOOL_COUNT = 2;

/** Providers name MCP tools `mcp__<server>__<tool>`. */
const MCP_TOOL_NAME = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/;

/**
 * Card types a reader needs to see without asking: a checklist, a question
 * with its answer and a plan. They keep their own rows and end a run.
 */
const STANDALONE_CONTENT_TYPES = new Set(['todo-list', 'question-answer']);

export type MessageListItem = ChatMessage | ToolGroupItem;

type CachedToolGroup = {
  /** The exact run the group was built from; reused only while every row keeps its identity. */
  run: ChatMessage[];
  /** Hidden reasoning both joins runs and changes what the preview names, so it is part of the key. */
  showThinking: boolean;
  group: ToolGroupItem;
};

// Chat rows keep their identity across a stream tick (useChatMessages' own
// projection cache), but grouping re-runs on every tick over a fresh array.
// Without this cache each collapsed run gets a brand-new group object, so
// `memo(ToolGroupContainer)` cannot bail and every group on screen re-renders
// ~10 times a second while only the streaming row actually changed. Keyed
// weakly on the run's first row so entries disappear with the rows themselves.
const toolGroupCache = new WeakMap<ChatMessage, CachedToolGroup>();

function isSameRun(cachedRun: ChatMessage[], run: ChatMessage[]): boolean {
  return cachedRun.length === run.length
    && cachedRun.every((message, index) => message === run[index]);
}

function humanizeToolAction(name: string): string {
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Who a call went to and what it asked for, as the transcript names it: an MCP
 * call is its server plus the action (`windows-pc-files`, `Edit File`); a
 * built-in tool is its own label with no separate action.
 */
export function describeToolCall(toolName: string): { source: string; action: string | null } {
  const mcpMatch = MCP_TOOL_NAME.exec(toolName);
  if (mcpMatch) {
    return { source: mcpMatch[1], action: humanizeToolAction(mcpMatch[2]) };
  }
  return { source: getToolConfig(toolName).input.label || formatToolDisplayName(toolName), action: null };
}

/** The run's tool calls, without the reasoning rows absorbed between them. */
function toolCallsOf(run: ChatMessage[]): (ChatMessage & { toolName: string })[] {
  return run.filter((message): message is ChatMessage & { toolName: string } => Boolean(message.isToolUse && message.toolName));
}

/** The group object for a run, reused unchanged while the run's rows are unchanged. */
function getToolGroup(run: ChatMessage[], showThinking: boolean): ToolGroupItem {
  const first = run[0];
  const cached = toolGroupCache.get(first);
  if (cached && cached.showThinking === showThinking && isSameRun(cached.run, run)) {
    return cached.group;
  }

  const calls = toolCallsOf(run);
  const sources = new Set(calls.map((message) => describeToolCall(message.toolName).source));
  const group: ToolGroupItem = {
    _isGroup: true,
    toolName: calls[0]?.toolName ?? '',
    messages: run,
    timestamp: first.timestamp,
    preview: buildGroupPreview(calls),
    toolCount: calls.length,
    failedCount: calls.filter((message) => message.toolResult?.isError === true).length,
    sourceName: sources.size === 1 ? [...sources][0] : null,
    callPreviews: run.map((message) => (message.isToolUse ? getToolInputPreview(message) : '')),
  };
  toolGroupCache.set(first, { run, showThinking, group });
  return group;
}

export function isToolGroupItem(item: MessageListItem): item is ToolGroupItem {
  return '_isGroup' in item && (item as ToolGroupItem)._isGroup === true;
}

// An agent's or a workflow's row is its whole card — status, timeline, result —
// and so are checklists, questions and plans; none of them folds into a run.
function isGroupableToolMessage(message: ChatMessage): message is ChatMessage & { toolName: string } {
  if (!message.isToolUse || !message.toolName || message.isSubagentContainer || message.toolName === 'Workflow') {
    return false;
  }
  const input = getToolConfig(message.toolName).input;
  return input.type !== 'plan' && input.type !== 'hidden' && !STANDALONE_CONTENT_TYPES.has(input.contentType ?? '');
}

// Messages that render nothing (reasoning hidden when showThinking is off)
// shouldn't split an otherwise-continuous run of tool calls.
function rendersNothing(message: ChatMessage, showThinking: boolean): boolean {
  return Boolean(message.isThinking && !showThinking);
}

function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }

  try {
    return JSON.parse(toolInput);
  } catch {
    return toolInput;
  }
}

function getToolInputPreview(message: ChatMessage): string {
  const config = getToolConfig(message.toolName || 'UnknownTool').input;
  const parsedInput = parseToolInput(message.toolInput);
  const title = typeof config.title === 'function' ? config.title(parsedInput) : config.title;
  const value = config.getValue?.(parsedInput);

  return String(value || title || message.displayText || message.content || '').trim();
}

/**
 * Builds the collapsed group's summary line.
 *
 * Computed here rather than in the component so it happens once per grouping
 * pass instead of once per group render, and skipped entirely for runs the tool
 * group cache above can reuse — a run's preview depends on the whole run, which
 * is exactly what that cache compares.
 */
function buildGroupPreview(messages: ChatMessage[]): string {
  const named = messages
    .slice(0, PREVIEWED_TOOL_COUNT)
    .map(getToolInputPreview)
    .filter(Boolean);

  const previewText = named.join(', ');
  // Subtracted from the previews actually printed, not from the two slots the
  // line reserves, so that named + extraCount === messages.length for every
  // input. A tool whose input yields no text — a Read with no file_path, an
  // input still arriving as partial JSON — is genuinely not named, so it
  // belongs in the remainder.
  const extraCount = messages.length - named.length;

  if (!previewText) {
    return extraCount > 0 ? `+${extraCount} more` : '';
  }

  return extraCount > 0 ? `${previewText}, +${extraCount} more` : previewText;
}

/**
 * Folds every run of consecutive tool calls into one group, whatever the tools,
 * the way Claude Desktop shows "Used windows-pc-files 5 times". Reasoning the
 * user can see is kept inside the run when another call follows it; reasoning
 * after the run's last call stays a row of its own.
 */
export function groupConsecutiveTools(
  messages: ChatMessage[],
  showThinking: boolean = true,
): MessageListItem[] {
  const items: MessageListItem[] = [];
  let index = 0;

  while (index < messages.length) {
    const message = messages[index];

    if (!isGroupableToolMessage(message)) {
      items.push(message);
      index += 1;
      continue;
    }

    const run: ChatMessage[] = [message];
    const pendingReasoning: ChatMessage[] = [];
    let nextIndex = index + 1;
    let runEnd = nextIndex;

    while (nextIndex < messages.length) {
      const candidate = messages[nextIndex];

      // Skip invisible interleaved messages so they don't break the run.
      if (rendersNothing(candidate, showThinking)) {
        nextIndex += 1;
        continue;
      }

      if (candidate.isThinking) {
        pendingReasoning.push(candidate);
        nextIndex += 1;
        continue;
      }

      if (isGroupableToolMessage(candidate)) {
        run.push(...pendingReasoning, candidate);
        pendingReasoning.length = 0;
        nextIndex += 1;
        runEnd = nextIndex;
        continue;
      }

      break;
    }

    if (toolCallsOf(run).length >= TOOL_GROUP_THRESHOLD) {
      items.push(getToolGroup(run, showThinking));
    } else {
      items.push(...run);
    }

    // Reasoning after the last call is walked again as ordinary rows.
    index = runEnd;
  }

  return items;
}

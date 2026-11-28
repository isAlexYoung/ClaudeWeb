import { stateForTool } from '@/modules/clawd';
import type { ClawdState } from '@/modules/clawd';
import { parseUsageLimitNotice } from '@/modules/chat/utils/usageLimitNotice';
import type { ChatMessage } from '@/shared/types';

export type ComposerClawdInput = {
  isProcessing: boolean;
  /** Permission requests waiting for the user. */
  pendingPermissions: number;
  /** The live status line of the running turn, when the provider sent one. */
  statusText?: string | null;
  messages: ChatMessage[];
  now?: number;
};

function lastMeaningful(messages: ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    // Background task reports and local command echoes say nothing about the turn itself.
    if (message.isTaskNotification || message.isLocalCommand || message.isLocalCommandStdout) continue;
    return message;
  }
  return undefined;
}

function isUsageLimit(message: ChatMessage | undefined, now: number): boolean {
  if (!message || (message.type !== 'assistant' && message.type !== 'error') || typeof message.content !== 'string') return false;
  const notice = parseUsageLimitNotice(message.content, message.timestamp);
  return Boolean(notice && (!notice.resetsAt || notice.resetsAt.getTime() > now));
}

/**
 * Used by ComposerClawd: what Claude is doing in this conversation right now, from the same state
 * the transcript shows. Finishing (done, stopped, error) is a moment, not a state: ComposerClawd
 * adds those when a turn ends; this only says what holds now.
 */
export function liveClawdState({ isProcessing, pendingPermissions, statusText, messages, now = Date.now() }: ComposerClawdInput): ClawdState {
  const last = lastMeaningful(messages);
  if (!isProcessing) return isUsageLimit(last, now) ? 'sleeping' : 'idle';
  if (pendingPermissions > 0) return 'waiting';
  if (last?.compact?.phase === 'running' || (statusText && /compact/i.test(statusText))) return 'compacting';
  if (!last || last.type === 'user') return 'thinking';
  if (last.isToolUse && !last.toolResult && last.toolStatus !== 'completed' && last.toolStatus !== 'failed') return stateForTool(last.toolName);
  if (last.isThinking) return 'thinking';
  if (last.isStreaming && last.type === 'assistant') return 'writing';
  return 'thinking';
}

/** How a turn that just ended ended, judged from its last row. */
export function finishedClawdState(messages: ChatMessage[], stoppedByUser: boolean, now = Date.now()): ClawdState {
  const last = lastMeaningful(messages);
  if (isUsageLimit(last, now)) return 'sleeping';
  if (last?.type === 'error') return 'error';
  if (stoppedByUser) return 'stopped';
  return 'done';
}

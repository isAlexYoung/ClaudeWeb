import type { ChatMessage } from '@/shared/types';

/**
 * Used by ChatMessagesPane to place Regenerate: the reply that ends the
 * conversation (the last finished assistant text after the last user message)
 * and the user message to run again. Null when the conversation does not end
 * in such a reply or that user message cannot be re-run (no transcript anchor).
 */
export function findRegenerateTarget(messages: ChatMessage[]): { reply: ChatMessage; from: ChatMessage } | null {
  let reply: ChatMessage | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === 'user') {
      return reply && message.transcriptAnchorId ? { reply, from: message } : null;
    }
    if (!reply && message.type === 'assistant' && !message.isToolUse && !message.isThinking
      && !message.isStreaming && String(message.content || '').trim()) {
      reply = message;
    }
  }
  return null;
}

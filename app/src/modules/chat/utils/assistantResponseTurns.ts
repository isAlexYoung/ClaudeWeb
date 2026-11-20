import type { AssistantResponseTurn, ChatMessage } from '@/shared/types';
import { getIntrinsicMessageKey } from '@/modules/chat/utils/messageKeys';

// Stable immutable source rows reuse their reasoning projection on every subsequent stream tick.
const reasoningRows = new WeakMap<ChatMessage, ChatMessage>();
function reasoningRow(message: ChatMessage): ChatMessage {
  let row = reasoningRows.get(message);
  if (!row) { row = { ...message, isThinking: true, content: message.reasoning, reasoning: undefined }; reasoningRows.set(message, row); }
  return row;
}

/** Used by ChatMessagesPane to keep SDK text/tool chunks in one user-facing response. */
export function assistantResponseTurns(messages: ChatMessage[], showThinking: boolean): AssistantResponseTurn[] {
  const turns: AssistantResponseTurn[] = [];
  let current: AssistantResponseTurn | undefined;
  for (const message of messages) {
    if (!current || (message.type === 'user' && !message.isTaskNotification)) {
      current = { key: getIntrinsicMessageKey(message) || `turn-${turns.length}`, user: message.type === 'user' ? message : undefined, messages: [], process: [], answer: [], copyContent: '' };
      turns.push(current);
    }
    if (message !== current.user) current.messages.push(message);
  }
  for (const turn of turns) {
    const visible = turn.messages.filter(message => showThinking || !message.isThinking).flatMap(message =>
      showThinking && !message.isThinking && message.reasoning
        ? [reasoningRow(message), message]
        : [message]);
    let lastProcess = -1;
    visible.forEach((message, index) => {
      if ((message.type !== 'assistant' && message.type !== 'error') || message.isToolUse || message.isThinking) lastProcess = index;
      if (message.model) turn.model = message.model;
    });
    turn.process = visible.slice(0, lastProcess + 1);
    turn.answer = visible.slice(lastProcess + 1);
    turn.copyContent = turn.messages.filter(message => message.type === 'assistant' && !message.isThinking && !message.isToolUse)
      .map(message => String(message.content || '')).filter(text => text.trim()).join('\n\n');
  }
  return turns;
}

import type { NormalizedMessage } from '@/shared/types';

/** One line of the spreadsheet's conversation drawer: a message, or how many tool calls ran between two. */
export type ConversationEntry =
  | { kind: 'message'; id: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'tools'; id: string; count: number };

/** Used by SheetConversation: messages, with each run of tool calls folded into one line. */
export function toConversationEntries(messages: NormalizedMessage[]): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (const message of messages) {
    if (message.kind === 'text' && (message.role === 'user' || message.role === 'assistant')) {
      const text = (message.content ?? '').trim();
      if (!text || message.isCompactSummary) continue;
      entries.push({ kind: 'message', id: message.id, role: message.role, text });
    } else if (message.kind === 'tool_use') {
      const last = entries[entries.length - 1];
      if (last?.kind === 'tools') last.count += 1;
      else entries.push({ kind: 'tools', id: `tools-${message.id}`, count: 1 });
    }
  }
  return entries;
}

import { expect, test } from 'vitest';

import { assistantResponseTurns } from '@/modules/chat/utils/assistantResponseTurns';
import type { ChatMessage } from '@/shared/types';

const text = (id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, type: 'assistant', content, timestamp: '2026-11-19T01:00:00Z', ...extra });

test('one response groups progress prose, reasoning and tools, keeping its final answer outside', () => {
  const rows = [text('u1', 'question', { type: 'user' }), text('t1', 'reasoning', { isThinking: true }), text('p1', 'checking files'), text('tool1', '', { type: 'tool', isToolUse: true, toolName: 'Read' }), text('a1', 'final answer', { model: 'claude-sonnet-5' })];
  const [turn] = assistantResponseTurns(rows, true);
  expect(turn.user).toBe(rows[0]); expect(turn.process).toEqual(rows.slice(1, 4)); expect(turn.answer).toEqual([rows[4]]);
  expect(turn.copyContent).toBe('checking files\n\nfinal answer'); expect(turn.model).toBe('claude-sonnet-5');
});

test('interrupted responses keep available text and separate user turns get separate footers', () => {
  const rows = [text('u1', 'question', { type: 'user' }), text('p1', 'partial response'), text('tool1', '', { type: 'tool', isToolUse: true, toolName: 'Read' }), text('u2', 'next question', { type: 'user' }), text('a2', 'second answer')];
  const turns = assistantResponseTurns(rows, true);
  expect(turns).toHaveLength(2); expect(turns[0].copyContent).toBe('partial response'); expect(turns[0].answer).toEqual([]); expect(turns[1].copyContent).toBe('second answer');
});

test('inline reasoning moves into the overall process without duplicating the answer or its copy text', () => {
  const reply = text('a1', 'final answer', { reasoning: 'inline reasoning' });
  const [turn] = assistantResponseTurns([reply], true);
  expect(turn.process[0].content).toBe('inline reasoning'); expect(turn.process[0].isThinking).toBe(true);
  expect(turn.answer).toEqual([reply]); expect(turn.copyContent).toBe('final answer');
  expect(assistantResponseTurns([reply], true)[0].process[0]).toBe(turn.process[0]);
  expect(assistantResponseTurns([reply], false)[0].process).toEqual([]);
});

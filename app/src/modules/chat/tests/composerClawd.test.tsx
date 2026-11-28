import assert from 'node:assert/strict';

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import ComposerClawd from '@/modules/chat/clawd/ComposerClawd';
import { finishedClawdState, liveClawdState } from '@/modules/chat/clawd/composerClawdState';
import type { ChatMessage } from '@/shared/types';

const at = '2026-11-28T10:00:00Z';
const user: ChatMessage = { type: 'user', content: 'hi', timestamp: at };
const tool = (toolName: string, done = false): ChatMessage => ({ type: 'assistant', isToolUse: true, toolName, toolResult: done ? { content: 'ok' } as never : null, timestamp: at });

test('the live state follows the turn: thinking, tools, writing, permission, compaction', () => {
  const base = { isProcessing: true, pendingPermissions: 0, messages: [user] };
  assert.equal(liveClawdState(base), 'thinking');
  assert.equal(liveClawdState({ ...base, messages: [user, tool('Edit')] }), 'editing');
  assert.equal(liveClawdState({ ...base, messages: [user, tool('Bash')] }), 'command');
  assert.equal(liveClawdState({ ...base, messages: [user, tool('Read')] }), 'searching');
  assert.equal(liveClawdState({ ...base, messages: [user, tool('Read', true)] }), 'thinking');
  assert.equal(liveClawdState({ ...base, messages: [user, { type: 'assistant', content: 'Sure', isStreaming: true, timestamp: at }] }), 'writing');
  assert.equal(liveClawdState({ ...base, messages: [user, { type: 'assistant', isThinking: true, timestamp: at }] }), 'thinking');
  assert.equal(liveClawdState({ ...base, pendingPermissions: 1, messages: [user, tool('Bash')] }), 'waiting');
  assert.equal(liveClawdState({ ...base, messages: [user, { type: 'assistant', compact: { phase: 'running' }, timestamp: at }] }), 'compacting');
  assert.equal(liveClawdState({ ...base, isProcessing: false }), 'idle');
});

test('a turn ends celebrating, stopped, upset, or asleep at a usage limit', () => {
  const now = Date.parse(at);
  assert.equal(finishedClawdState([user, { type: 'assistant', content: 'Done.', timestamp: at }], false, now), 'done');
  assert.equal(finishedClawdState([user, { type: 'assistant', content: 'Done.', timestamp: at }], true, now), 'stopped');
  assert.equal(finishedClawdState([user, { type: 'error', content: 'Boom', timestamp: at }], false, now), 'error');
  const limit: ChatMessage = { type: 'assistant', content: 'Claude AI usage limit reached|' + String(Math.floor((now + 3_600_000) / 1000)), timestamp: at };
  assert.equal(finishedClawdState([user, limit], false, now), 'sleeping');
  assert.equal(liveClawdState({ isProcessing: false, pendingPermissions: 0, messages: [user, limit], now }), 'sleeping');
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Props = Parameters<typeof ComposerClawd>[0];
const props = (overrides: Partial<Props> = {}): Props => ({
  conversationKey: 'p:s1', isProcessing: false, isStopping: false, pendingPermissions: 0, messages: [user],
  still: false, doubleClick: true, ...overrides,
});
const state = (view: ReturnType<typeof render>) => view.container.querySelector('[data-clawd-state]')?.getAttribute('data-clawd-state');
const flush = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

test('Clawd above the composer acts out the turn, holds each state briefly, and celebrates the end', async () => {
  const view = render(<ComposerClawd {...props()} />);
  assert.equal(state(view), 'idle');
  view.rerender(<ComposerClawd {...props({ isProcessing: true })} />);
  await flush(10);
  assert.equal(state(view), 'thinking');
  view.rerender(<ComposerClawd {...props({ isProcessing: true, messages: [user, tool('Edit')] })} />);
  await flush(500);
  assert.equal(state(view), 'thinking', 'a state shows at least 1.5 s');
  await flush(1100);
  assert.equal(state(view), 'editing');
  view.rerender(<ComposerClawd {...props({ isProcessing: true, pendingPermissions: 1, messages: [user, tool('Bash')] })} />);
  await flush(10);
  assert.equal(state(view), 'waiting', 'a permission request shows at once');
  view.rerender(<ComposerClawd {...props({ isProcessing: false, messages: [user, tool('Bash', true), { type: 'assistant', content: 'Done', timestamp: at }] })} />);
  await flush(10);
  assert.equal(state(view), 'done');
  await flush(4100);
  await flush(1600);
  assert.equal(state(view), 'idle');
});

test('a stopped turn is shown as stopped, and switching conversations never celebrates', async () => {
  const view = render(<ComposerClawd {...props({ isProcessing: true })} />);
  view.rerender(<ComposerClawd {...props({ isProcessing: true, isStopping: true })} />);
  // The stop flag clears in the same update that ends the turn.
  view.rerender(<ComposerClawd {...props({ isProcessing: false, isStopping: false })} />);
  await flush(10);
  assert.equal(state(view), 'stopped');

  view.rerender(<ComposerClawd {...props({ conversationKey: 'p:s2', isProcessing: true })} />);
  await flush(1600);
  view.rerender(<ComposerClawd {...props({ conversationKey: 'p:s3', isProcessing: false })} />);
  await flush(1600);
  assert.equal(state(view), 'idle');
});

test('a double click shows another animation of the same state, unless switching is off', async () => {
  const view = render(<ComposerClawd {...props()} />);
  const sprite = () => view.container.querySelector('canvas') as HTMLCanvasElement;
  const first = sprite().getAttribute('data-clawd-animation');
  fireEvent.doubleClick(sprite());
  assert.notEqual(sprite().getAttribute('data-clawd-animation'), first);
  assert.equal(state(view), 'idle');
  view.rerender(<ComposerClawd {...props({ doubleClick: false })} />);
  const current = sprite().getAttribute('data-clawd-animation');
  await flush(500);
  fireEvent.doubleClick(sprite());
  assert.equal(sprite().getAttribute('data-clawd-animation'), current);
});

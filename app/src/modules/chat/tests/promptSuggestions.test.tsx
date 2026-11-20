import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';

import { usePromptSuggestion } from '@/modules/chat/hooks/usePromptSuggestion';
import type { ServerEvent } from '@/shared/types';

function setup() {
  const listeners = new Set<(event: ServerEvent) => void>();
  const subscribe = (listener: (event: ServerEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const emit = (event: ServerEvent) => act(() => { listeners.forEach(listener => listener(event)); });
  const props = { sessionId: 's1' as string | null, subscribe, enabled: true, input: '', blocked: false, loading: false };
  const view = renderHook(value => usePromptSuggestion(value), { initialProps: props });
  const begin = (id = 'turn1', sessionId = 's1') => emit({ kind: 'status', text: 'prompt_suggestion_turn', requestId: id, sessionId });
  const suggest = (content = '发布', id = 'turn1', sessionId = 's1') => emit({ kind: 'status', text: 'prompt_suggestion', requestId: id, sessionId, content });
  return { ...view, props, emit, begin, suggest };
}

it('displays an SDK suggestion after completion without modifying the input', () => {
  const view = setup(); view.begin();
  view.emit({ kind: 'complete', sessionId: 's1', exitCode: 0 }); view.suggest();
  expect(view.result.current.suggestion).toBe('发布'); expect(view.props.input).toBe('');
});

it('ignores other sessions and a late suggestion from a previous run', () => {
  const view = setup(); view.begin(); view.begin('turn2');
  view.suggest(); view.suggest('other', 'turn2', 's2'); expect(view.result.current.suggestion).toBe('');
  view.suggest('当前建议', 'turn2'); expect(view.result.current.suggestion).toBe('当前建议');
});

it('typing then clearing does not bring back a dismissed suggestion or allow a late one', () => {
  const view = setup(); view.begin(); view.suggest();
  view.rerender({ ...view.props, input: 'my own text' }); view.rerender(view.props); view.suggest();
  expect(view.result.current.suggestion).toBe('');
  view.begin('turn2'); view.suggest('新一轮', 'turn2'); expect(view.result.current.suggestion).toBe('新一轮');
});

it('dismissal, editing, queued text or attachments never overwrite a draft', () => {
  const view = setup(); view.begin(); view.suggest(); act(() => view.result.current.dismiss()); view.suggest();
  expect(view.result.current.suggestion).toBe('');
  view.begin('turn2'); view.rerender({ ...view.props, blocked: true }); view.suggest('queued', 'turn2');
  view.rerender(view.props); expect(view.result.current.suggestion).toBe('');
});

it('clears suggestions on session change, disabled setting, error or reconnect', () => {
  const view = setup(); view.begin(); view.suggest();
  view.rerender({ ...view.props, sessionId: 's2' }); expect(view.result.current.suggestion).toBe('');
  view.rerender(view.props); view.begin(); view.suggest(); view.emit({ kind: 'error', sessionId: 's1' });
  expect(view.result.current.suggestion).toBe('');
  view.begin(); view.suggest(); view.emit({ kind: 'websocket_reconnected' }); expect(view.result.current.suggestion).toBe('');
  view.rerender({ ...view.props, enabled: false }); view.begin(); view.suggest(); expect(view.result.current.suggestion).toBe('');
});

it('does not show a suggestion while processing, but retains one arriving just after result', () => {
  const view = setup(); view.rerender({ ...view.props, loading: true }); view.begin();
  view.emit({ kind: 'complete', sessionId: 's1' }); view.suggest(); expect(view.result.current.suggestion).toBe('');
  view.rerender(view.props); expect(view.result.current.suggestion).toBe('发布');
});

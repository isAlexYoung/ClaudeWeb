import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useChatAbortFeedback } from '@/modules/chat/hooks/useChatAbortFeedback';
import type { ServerEvent } from '@/shared/types';

afterEach(() => vi.useRealTimers());

function setup() {
  const abort = vi.fn();
  const listeners = new Set<(event: ServerEvent) => void>();
  const subscribe = (listener: (event: ServerEvent) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const props = { sessionId: 's1', isProcessing: true, canAbort: true, isConnected: true, abort, subscribe };
  const hook = renderHook(input => useChatAbortFeedback(input), { initialProps: props });
  return { ...hook, props, abort, emit: (event: ServerEvent) => act(() => listeners.forEach(listener => listener(event))) };
}

test('acknowledges Stop immediately, deduplicates clicks, and waits for its own terminal event', () => {
  const view = setup();
  act(() => { view.result.current.requestAbort(); view.result.current.requestAbort(); });
  expect(view.abort).toHaveBeenCalledTimes(1);
  expect(view.result.current.isStopping).toBe(true);
  view.emit({ kind: 'stream_end', sessionId: 's1' });
  view.emit({ kind: 'chat_subscribed', sessionId: 's1', isProcessing: true });
  view.emit({ kind: 'complete', sessionId: 'another' });
  expect(view.result.current.isStopping).toBe(true);
  view.emit({ kind: 'complete', sessionId: 's1', aborted: true, exitCode: 0 });
  expect(view.result.current.isStopping).toBe(false);
  expect(view.result.current.stopError).toBeNull();
});

test('pending requests remain independent when switching sessions and late completion cannot stop the new one', () => {
  const view = setup();
  act(() => view.result.current.requestAbort());
  view.rerender({ ...view.props, sessionId: 's2' });
  expect(view.result.current.isStopping).toBe(false);
  act(() => view.result.current.requestAbort());
  view.emit({ kind: 'complete', sessionId: 's1', aborted: true });
  expect(view.result.current.isStopping).toBe(true);
  view.rerender(view.props);
  expect(view.result.current.isStopping).toBe(false);
  view.rerender({ ...view.props, sessionId: 's2' });
  expect(view.result.current.isStopping).toBe(true);
});

test('timeout permits a retry without declaring the task stopped, and late confirmation clears the notice', () => {
  vi.useFakeTimers();
  const view = setup();
  act(() => view.result.current.requestAbort());
  act(() => vi.advanceTimersByTime(15_000));
  expect(view.result.current.isStopping).toBe(false);
  expect(view.result.current.stopError).toBe('timeout');
  act(() => view.result.current.requestAbort());
  expect(view.abort).toHaveBeenCalledTimes(2);
  expect(view.result.current.isStopping).toBe(true);
  act(() => vi.advanceTimersByTime(15_000));
  view.emit({ kind: 'complete', sessionId: 's1', aborted: true });
  expect(view.result.current.stopError).toBeNull();
});

test('disconnection and send failures release the button with honest failure feedback', () => {
  const view = setup();
  act(() => view.result.current.requestAbort());
  view.rerender({ ...view.props, isConnected: false });
  expect(view.result.current.stopError).toBe('disconnected');
  act(() => view.result.current.requestAbort());
  expect(view.abort).toHaveBeenCalledTimes(1);
  view.rerender(view.props);
  view.abort.mockImplementation(() => { throw new Error('closed'); });
  act(() => view.result.current.requestAbort());
  expect(view.result.current.isStopping).toBe(false);
  expect(view.result.current.stopError).toBe('failed');
});

test('backend rejection and unsuccessful abort are not reported as successful stops', () => {
  const view = setup();
  act(() => view.result.current.requestAbort());
  view.emit({ kind: 'protocol_error', sessionId: 's1', code: 'NO_SUCH_TASK' });
  expect(view.result.current.isStopping).toBe(true);
  view.emit({ kind: 'protocol_error', sessionId: 's1', code: 'REQUEST_FAILED' });
  expect(view.result.current.stopError).toBe('failed');
  act(() => view.result.current.requestAbort());
  view.emit({ kind: 'complete', sessionId: 's1', aborted: true, exitCode: 1 });
  expect(view.result.current.stopError).toBe('failed');
});

test('authoritative idle state clears pending feedback and inactive runs never send an abort', () => {
  const view = setup();
  act(() => view.result.current.requestAbort());
  view.rerender({ ...view.props, isProcessing: false, canAbort: false });
  expect(view.result.current.isStopping).toBe(false);
  act(() => view.result.current.requestAbort());
  expect(view.abort).toHaveBeenCalledTimes(1);
});

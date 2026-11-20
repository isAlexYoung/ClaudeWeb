import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';

const close = () => {};
afterEach(() => vi.unstubAllGlobals());

test.each([[1482, 722, 374, 627], [2560, 1305, 928, 1227]])('Add stays aligned to its left-side trigger at viewport %dx%d', (width, height, triggerLeft, triggerTop) => {
  vi.stubGlobal('innerWidth', width); vi.stubGlobal('innerHeight', height);
  const { result } = renderHook(() => useComposerMenuAnchor(false, close, 620, 'start'));
  result.current.triggerRef.current = { getBoundingClientRect: () => ({ left: triggerLeft, right: triggerLeft + 28, top: triggerTop }) } as HTMLButtonElement;
  act(() => result.current.updateAnchor());
  const anchor = result.current.anchor!;
  expect(width - anchor.right - anchor.maxWidth).toBe(triggerLeft);
  expect(height - anchor.bottom).toBe(triggerTop - 8);
});

test('a start-aligned menu near the right edge moves inside the viewport instead of overflowing', () => {
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
  const { result } = renderHook(() => useComposerMenuAnchor(false, close, 620, 'start'));
  result.current.triggerRef.current = { getBoundingClientRect: () => ({ left: 750, right: 778, top: 500 }) } as HTMLButtonElement;
  act(() => result.current.updateAnchor());
  expect(result.current.anchor!.right).toBe(8);
  expect(result.current.anchor!.maxWidth).toBe(620);
});

test('a left-side mobile trigger moves the whole menu inside the screen', () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const { result } = renderHook(() => useComposerMenuAnchor(false, close, 300));
  result.current.triggerRef.current = { getBoundingClientRect: () => ({ top: 600, right: 120 }) } as HTMLButtonElement;
  act(() => result.current.updateAnchor());
  const anchor = result.current.anchor!;
  expect(anchor.maxWidth).toBe(300);
  expect(390 - anchor.right - anchor.maxWidth).toBeGreaterThanOrEqual(8);
});

test('zoomed visual viewport and the keyboard bound the menu without an oversized minimum', () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  const viewport = Object.assign(new EventTarget(), { width: 180, height: 260, offsetLeft: 35, offsetTop: 20 });
  vi.stubGlobal('visualViewport', viewport);
  const { result } = renderHook(() => useComposerMenuAnchor(true, close, 608));
  result.current.triggerRef.current = { getBoundingClientRect: () => ({ top: 650, right: 100 }) } as HTMLButtonElement;
  act(() => viewport.dispatchEvent(new Event('resize')));
  const anchor = result.current.anchor!;
  const left = 390 - anchor.right - anchor.maxWidth;
  const bottom = 844 - anchor.bottom;
  expect(anchor.maxWidth).toBe(164);
  expect(left).toBeGreaterThanOrEqual(43);
  expect(bottom).toBeLessThanOrEqual(272);
  expect(bottom - anchor.maxHeight).toBeGreaterThanOrEqual(28);
});

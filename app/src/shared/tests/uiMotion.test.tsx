import assert from 'node:assert/strict';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { SURFACE_EXIT_MS } from '@/shared/constants';
import { useViewMotion } from '@/shared/hooks/useViewMotion';
import { MotionSurface } from '@/shared/ui/MotionSurface';
import { Dialog, DialogContent, DialogTrigger } from '@/shared/ui/Dialog';

let reduced = false;
const listeners = new Set<() => void>();
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  listeners.clear();
  vi.stubGlobal('matchMedia', () => ({
    get matches() { return reduced; },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('closing a surface immediately removes it from focus/navigation, then releases its DOM', () => {
  const view = render(<MotionSurface open><button>Choose</button></MotionSurface>);
  view.rerender(<MotionSurface open={false}><button>Choose</button></MotionSurface>);
  assert.equal(view.queryByRole('button'), null);
  assert.equal(view.container.firstElementChild?.hasAttribute('inert'), true);
  assert.equal(view.container.firstElementChild?.getAttribute('data-motion-state'), 'closed');
  act(() => vi.advanceTimersByTime(SURFACE_EXIT_MS - 1));
  assert.ok(view.container.firstElementChild);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(view.container.firstElementChild, null);
});

test('reopening during exit keeps the existing input and cancels the old removal', () => {
  const panel = (open: boolean) => <MotionSurface open={open}><input aria-label="Draft" defaultValue="" /></MotionSurface>;
  const view = render(panel(true));
  const input = view.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  view.rerender(panel(false));
  act(() => vi.advanceTimersByTime(70));
  view.rerender(panel(true));
  act(() => vi.advanceTimersByTime(SURFACE_EXIT_MS * 2));
  assert.equal(view.getByRole('textbox'), input);
  assert.equal((input as HTMLInputElement).value, 'Keep this draft');
  assert.equal(input.parentElement?.hasAttribute('inert'), false);
});

test('reduced motion removes an exiting surface immediately, including a live OS change', () => {
  const view = render(<MotionSurface open>Panel</MotionSurface>);
  view.rerender(<MotionSurface open={false}>Panel</MotionSurface>);
  act(() => { reduced = true; listeners.forEach(listener => listener()); });
  assert.equal(view.container.firstElementChild, null);
  view.rerender(<MotionSurface open>Panel</MotionSurface>);
  view.rerender(<MotionSurface open={false}>Panel</MotionSurface>);
  assert.equal(view.container.firstElementChild, null);
});

test('unmount cancels pending removal and media-query listeners', () => {
  const view = render(<MotionSurface open>Panel</MotionSurface>);
  view.rerender(<MotionSurface open={false}>Panel</MotionSurface>);
  view.unmount();
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(listeners.size, 0);
});

test('view motion runs only for navigation, preserves drafts, and cancels on new navigation or reduced motion', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  function View({ identity, text }: { identity: string; text: string }) {
    const ref = useViewMotion(identity);
    return <div ref={ref}><input aria-label="Draft" defaultValue="" /><p>{text}</p></div>;
  }
  try {
    const view = render(<View identity="chat" text="Starting" />);
    const input = view.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Unsent draft' } });
    view.rerender(<View identity="chat" text="Streaming another token" />);
    assert.equal(animate.mock.calls.length, 1);
    view.rerender(<View identity="tasks" text="Tasks" />);
    assert.equal(animate.mock.calls.length, 2);
    assert.equal(cancel.mock.calls.length, 1);
    assert.equal(view.getByRole('textbox'), input);
    assert.equal((input as HTMLInputElement).value, 'Unsent draft');
    act(() => { reduced = true; listeners.forEach(listener => listener()); });
    assert.equal(cancel.mock.calls.length, 2);
    view.rerender(<View identity="chat" text="Back" />);
    assert.equal(animate.mock.calls.length, 2);
  } finally { Reflect.deleteProperty(HTMLElement.prototype, 'animate'); }
});

test('closing a dialog restores focus immediately and retains its content through exit', () => {
  const dialog = (open: boolean) => <Dialog open={open}>
    <DialogTrigger>Open</DialogTrigger>
    <DialogContent><button>Panel action</button></DialogContent>
  </Dialog>;
  const view = render(dialog(false));
  const trigger = view.getByRole('button', { name: 'Open' });
  trigger.focus();
  view.rerender(dialog(true));
  act(() => vi.advanceTimersByTime(30));
  assert.equal(document.activeElement?.textContent, 'Panel action');
  view.rerender(dialog(false));
  assert.equal(document.activeElement, trigger);
  assert.equal(view.queryByRole('dialog'), null);
  assert.ok(document.querySelector('.motion-modal[aria-hidden="true"] button'));
  act(() => vi.advanceTimersByTime(SURFACE_EXIT_MS));
  assert.equal(document.querySelector('.motion-modal'), null);
});

test('a dialog closed before its autofocus frame cannot steal focus during exit', () => {
  const panel = (open: boolean) => <Dialog open={open}><DialogTrigger>Open</DialogTrigger>
    <DialogContent><button>Panel action</button></DialogContent></Dialog>;
  const view = render(panel(false));
  const trigger = view.getByRole('button', { name: 'Open' });
  trigger.focus();
  view.rerender(panel(true));
  view.rerender(panel(false));
  act(() => vi.advanceTimersByTime(30));
  assert.equal(document.activeElement, trigger);
});

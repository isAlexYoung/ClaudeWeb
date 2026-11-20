import { afterEach, expect, test, vi } from 'vitest';

import { animateTranscriptScroll } from '@/modules/chat/utils/animateTranscriptScroll';

afterEach(() => vi.unstubAllGlobals());

function fixture(reduced = false) {
  let serial = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  const container = document.createElement('div');
  Object.defineProperty(container, 'scrollHeight', { value: 2000 });
  Object.defineProperty(container, 'clientHeight', { value: 500 });
  container.scrollTop = 900;
  return { container, frame: (now: number) => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(now)); } };
}

test('search and rail jumps ease in and out rather than teleporting to the target', () => {
  const { container, frame } = fixture(); const done = vi.fn();
  animateTranscriptScroll(container, () => 100, done);
  expect(container.scrollTop).toBe(900);
  frame(180); expect(container.scrollTop).toBe(850);
  frame(360); expect(container.scrollTop).toBe(500);
  frame(540); expect(container.scrollTop).toBe(150);
  frame(720); expect(container.scrollTop).toBe(100);
  frame(736); expect(done).toHaveBeenCalledTimes(1);
  expect(container.style.overflowAnchor).toBe('');
});

test('tracks lazy-row measurements during the animation and eases a late correction', () => {
  const { container, frame } = fixture(); const done = vi.fn(); let target = 100;
  animateTranscriptScroll(container, () => target, done);
  frame(360); target = 200;
  frame(720); expect(container.scrollTop).toBe(200);
  target = 300; frame(736);
  expect(container.scrollTop).toBe(200);
  frame(866); expect(container.scrollTop).toBe(250);
  frame(996); frame(1012);
  expect(container.scrollTop).toBe(300); expect(done).toHaveBeenCalledTimes(1);
});

test('cancellation stops pending frames and restores native scrolling behavior', () => {
  const { container, frame } = fixture(); const done = vi.fn();
  container.style.scrollBehavior = 'smooth';
  const cancel = animateTranscriptScroll(container, () => 100, done);
  frame(180); cancel(); const atCancel = container.scrollTop;
  frame(720); expect(container.scrollTop).toBe(atCancel);
  expect(done).not.toHaveBeenCalled(); expect(container.style.scrollBehavior).toBe('smooth');
});

test('reduced-motion preference and destinations outside the transcript are respected', () => {
  const { container } = fixture(true); const done = vi.fn();
  animateTranscriptScroll(container, () => 9000, done);
  expect(container.scrollTop).toBe(1500); expect(done).toHaveBeenCalledTimes(1);
});

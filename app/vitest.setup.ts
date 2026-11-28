import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { resetSessionCaches } from '@/shared/sessionCache';

// Auto-cleanup only self-registers when vitest globals are enabled, and they are
// not. Without this, a hook rendered in one test stays mounted — with its timers
// and effects live — for the rest of the file.
afterEach(cleanup);

// The chat's session store is page-lifetime state; a test reusing a session id
// must not find the previous test's messages in it.
afterEach(resetSessionCaches);

// jsdom has no canvas: getContext logs "Not implemented" and returns null. Return the same null
// quietly, so pages drawing on a canvas (Clawd, charts) do not flood every test's output.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// jsdom ships no `matchMedia`, and components that pick a layout from the
// viewport call it during render. Report the desktop breakpoint, which is the
// layout the sidebar row tests assert on.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

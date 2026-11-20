import assert from 'node:assert/strict';

import { act, render, waitFor } from '@testing-library/react';
import { test, vi } from 'vitest';

import { BrowserPanel } from '@/modules/browser-panel';
import { bindBrowserClipboard } from '@/modules/browser-panel/browserClipboard';

const browserApi = vi.hoisted(() => ({ available: vi.fn(), status: vi.fn(), end: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { browser: browserApi } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// Fake elements, as in WebDesktop's clipboard tests: jsdom cannot make a trusted event.
type Handler = (event: Record<string, unknown>) => void;
function element() {
  const handlers = new Map<string, Handler[]>();
  return {
    value: '',
    focus: vi.fn(),
    querySelector: () => null,
    contains: () => false,
    addEventListener: (type: string, handler: Handler) => { handlers.set(type, [...(handlers.get(type) ?? []), handler]); },
    removeEventListener: (type: string, handler: Handler) => { handlers.set(type, (handlers.get(type) ?? []).filter((item) => item !== handler)); },
    emit: (type: string, event: Record<string, unknown>) => { for (const handler of handlers.get(type) ?? []) handler(event); },
  };
}
const keyEvent = (key: string, extra: Record<string, unknown> = {}) => {
  const event = { isTrusted: true, key, code: `Key${key.toUpperCase()}`, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
    repeat: false, defaultPrevented: false, preventDefault: () => { event.defaultPrevented = true; }, stopImmediatePropagation: () => {}, ...extra };
  return event;
};

function setup() {
  const host = element(), proxy = element();
  const keys: Array<[number, string, boolean | undefined]> = [];
  const rfb = { focus: vi.fn(), sendKey: (keysym: number, code: string, down?: boolean) => { keys.push([keysym, code, down]); } };
  const copy = vi.fn(async () => {});
  const paste = vi.fn(async () => {});
  const error = vi.fn();
  const unbind = bindBrowserClipboard({ host: host as unknown as HTMLElement, proxy: proxy as unknown as HTMLTextAreaElement, rfb, copy, paste, error });
  return { host, proxy, keys, copy, paste, error, unbind };
}

test('Ctrl+C asks the remote browser to copy and keeps the key from noVNC', async () => {
  const { host, copy, unbind } = setup();
  const event = keyEvent('c');
  host.emit('keydown', event);
  assert.equal(event.defaultPrevented, true);
  await waitFor(() => assert.equal(copy.mock.calls.length, 1));
  assert.equal((copy.mock.calls[0] as unknown[])[0], false);
  unbind();
});

test('untrusted key events are ignored', () => {
  const { host, copy, unbind } = setup();
  host.emit('keydown', keyEvent('x', { isTrusted: false }));
  assert.equal(copy.mock.calls.length, 0);
  unbind();
});

test('Ctrl+V pastes the local text, then presses Ctrl+V in the browser', async () => {
  const { host, proxy, keys, paste, unbind } = setup();
  const key = keyEvent('v');
  host.emit('keydown', key);
  assert.equal(key.defaultPrevented, false, 'the browser must deliver its paste event');
  assert.equal(proxy.focus.mock.calls.length, 1, 'the paste lands in the hidden input, not in noVNC');
  proxy.emit('paste', { isTrusted: true, clipboardData: { getData: () => 'hello', files: [] }, preventDefault: () => {}, stopImmediatePropagation: () => {} });
  await waitFor(() => assert.equal(keys.length, 3));
  assert.deepEqual((paste.mock.calls[0] as unknown[])[0], { text: 'hello', files: [] });
  assert.deepEqual(keys, [[0xffe3, 'ControlLeft', true], [0x76, 'KeyV', undefined], [0xffe3, 'ControlLeft', false]]);
  unbind();
});

test('without WebDesktop 3.0.3 the panel says what is needed and does not connect', async () => {
  browserApi.available.mockResolvedValue({ ok: true, json: async () => ({ available: false }) });
  const view = render(<BrowserPanel visible />);
  await waitFor(() => assert.equal(view.getByTestId('browser-panel').dataset.status, 'unavailable'));
  assert.ok(view.getByText('workspace.browser.unavailable'));
  assert.equal(browserApi.status.mock.calls.length, 0);
  act(() => view.unmount());
  assert.equal(browserApi.end.mock.calls.length, 0);
});

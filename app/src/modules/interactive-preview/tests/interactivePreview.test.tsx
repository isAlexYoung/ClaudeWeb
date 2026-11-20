import assert from 'node:assert/strict';

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import { InteractivePreview } from '@/modules/interactive-preview/InteractivePreview';
import { i18n } from '@/modules/i18n';

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(() => vi.unstubAllGlobals());
const source = '<!doctype html><html><body><canvas id="scene"></canvas></body></html>';

test('stop removes the executable frame, run restores it, source is passive and refresh resets errors', async () => {
  const view = render(<InteractivePreview source={source} title="Scene" />);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
  const first = view.container.querySelector('iframe')!;
  assert.equal(first.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(first.getAttribute('referrerpolicy'), 'no-referrer');
  assert.match(first.srcdoc, /connect-src 'none'/);
  fireEvent.click(view.getByRole('button', { name: 'Stop visual' }));
  assert.equal(view.container.querySelector('iframe') === null, true);
  fireEvent.click(view.getByRole('button', { name: 'Run visual' }));
  assert.equal(view.container.querySelector('iframe') !== null, true);
  fireEvent.click(view.getByRole('button', { name: 'View visual source' }));
  assert.equal(view.container.querySelector('iframe') === null, true);
  assert.match(view.container.querySelector('pre')?.textContent || '', /<canvas/);
  fireEvent.click(view.getByRole('button', { name: 'Restart visual' }));
  assert.equal(view.container.querySelector('iframe') !== null, true);
  fireEvent.click(view.getByRole('checkbox'));
  assert.match(view.container.querySelector('iframe')!.srcdoc, /chart\.js@4\.4\.7/);
});

test('a follow-up can only reach the composer after the host button is clicked', async () => {
  const onFollowUp = vi.fn();
  const view = render(<InteractivePreview source={source} title="Scene" onFollowUp={onFollowUp} />);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
  const frame = view.container.querySelector('iframe')!;
  const channel = /const channel = "([^"]+)"/.exec(frame.srcdoc)![1];
  const data = { type: 'claudeweb-visual', channel, kind: 'follow-up', text: 'Compare Q3' };
  act(() => window.dispatchEvent(new MessageEvent('message', { data, source: window })));
  assert.equal(view.queryByText('Compare Q3') === null, true);
  act(() => window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow })));
  assert.ok(view.getByText('Compare Q3'));
  assert.equal(onFollowUp.mock.calls.length, 0);
  fireEvent.click(view.getByRole('button', { name: 'Add to message' }));
  assert.deepEqual(onFollowUp.mock.calls, [['Compare Q3']]);
});

test('expanded previews close with Escape, restore scrolling and can run again inline', async () => {
  const view = render(<InteractivePreview source={source} title="Scene" />);
  fireEvent.click(view.getByRole('button', { name: 'Expand visual' }));
  assert.ok(view.getByRole('dialog', { name: 'Scene' }));
  assert.equal(document.body.style.overflow, 'hidden');
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(view.queryByRole('dialog') === null, true);
  assert.equal(document.body.style.overflow, '');
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
});

test('offscreen previews do not execute and are destroyed when scrolled away', () => {
  let notify: IntersectionObserverCallback | undefined;
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { notify = callback; }
    observe() {} disconnect() {}
  });
  const view = render(<InteractivePreview source={source} title="Scene" />);
  assert.equal(view.container.querySelector('iframe') === null, true);
  act(() => notify!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  assert.equal(view.container.querySelector('iframe') !== null, true);
  act(() => notify!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  assert.equal(view.container.querySelector('iframe') === null, true);
});

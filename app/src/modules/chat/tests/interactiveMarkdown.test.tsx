import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, test } from 'vitest';

import { Markdown } from '@/modules/chat/transcript/Markdown';
import StreamingMarkdown from '@/modules/chat/transcript/StreamingMarkdown';
import { TranscriptRenderContext } from '@/modules/chat/context/TranscriptRenderContext';
import { MarkdownWorkspaceContext } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { i18n } from '@/modules/i18n';

beforeEach(async () => { await i18n.changeLanguage('en'); });
const html = '```html\n<!doctype html><html><body><canvas></canvas></body></html>\n```';

test('closed HTML fragments and full HTML/SVG documents render in the same interactive preview', async () => {
  const view = render(<Markdown>{html}</Markdown>);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
  fireEvent.click(view.getByRole('button', { name: 'View visual source' }));
  assert.equal(view.container.querySelector('iframe') === null, true);
  view.rerender(<Markdown>{'```html\n<div>example</div>\n```'}</Markdown>);
  await waitFor(() => assert.equal(view.container.querySelector('iframe')?.srcdoc.includes('<div>example</div>'), true));
  view.rerender(<Markdown>{'```html\n<!doctype html><html><body><canvas>'}</Markdown>);
  assert.equal(view.container.querySelector('iframe') === null, true);
  view.rerender(<Markdown>{'```svg\n<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>\n```'}</Markdown>);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
});

test('the reported div/canvas/script response renders, including a historical reply without a doctype', async () => {
  const fragment = '<div style="background:#1b1d22"><canvas id="saddle"></canvas></div>\n<script>const cv=document.getElementById("saddle");cv.getContext("2d");</script>';
  const view = render(<Markdown>{'Before\n\n```html\n' + fragment + '\n```\n\nAfter'}</Markdown>);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
  const frame = view.container.querySelector('iframe')!;
  assert.match(frame.srcdoc, /<canvas id="saddle">/);
  assert.match(frame.srcdoc, /cv.getContext\("2d"\)/);
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
});

test('streaming never runs an unclosed HTML fence, even after its html or script closing tag arrives', async () => {
  const fragment = '```html\n<div><canvas></canvas></div>\n<script>window.counter=1</script>';
  const view = render(<StreamingMarkdown content={fragment} isStreaming />);
  assert.equal(view.container.querySelector('iframe') === null, true);
  view.rerender(<StreamingMarkdown content={'```html\n<html><body></body></html>'} isStreaming />);
  assert.equal(view.container.querySelector('iframe') === null, true);
  view.rerender(<StreamingMarkdown content={fragment + '\n```\n\nDone'} isStreaming />);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, true));
  const frame = view.container.querySelector('iframe');
  view.rerender(<StreamingMarkdown content={fragment + '\n```\n\nDone, more explanation'} isStreaming />);
  assert.equal(view.container.querySelector('iframe') === frame, true, 'later text does not restart a settled visual');
});

test.each([
  ['~~~HTML\n<div>tilde</div>\n~~~', true],
  ['````htm\n<div>long fence</div>\n````', true],
  ['> ```html\n> <div>quoted</div>\n> ```', true],
  ['- ```html\n  <div>list</div>\n  ```', true],
  ['````html\n<div>still streaming</div>\n```', false],
  ['```html\n<div>literal marker</div>\n    ```', false],
  ['```html\n<div>literal quote</div>\n> ```', false],
])('only a matching Markdown closing fence runs: %s', async (content, expected) => {
  const view = render(<Markdown>{content}</Markdown>);
  await waitFor(() => assert.equal(view.container.querySelector('iframe') !== null, expected));
});

test('transcript exports contain passive source, and inactive chats never run visual frames', () => {
  const view = render(<TranscriptRenderContext.Provider value={{ isExporting: true }}><Markdown>{html}</Markdown></TranscriptRenderContext.Provider>);
  assert.equal(view.container.querySelector('iframe') === null, true);
  assert.match(view.container.textContent || '', /<canvas>/);
  view.rerender(<MarkdownWorkspaceContext.Provider value={{ projectId: 'p', active: false }}><Markdown>{html}</Markdown></MarkdownWorkspaceContext.Provider>);
  assert.equal(view.container.querySelector('iframe') === null, true);
});

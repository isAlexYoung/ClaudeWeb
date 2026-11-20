import assert from 'node:assert/strict';
import { Blob as NodeBlob } from 'node:buffer';

import { afterEach, beforeEach, test, vi } from 'vitest';

import { loadWorkspaceVisual, readPreviewBytes } from '@/modules/interactive-preview/utils/workspaceVisual';

const { readFileBlob } = vi.hoisted(() => ({ readFileBlob: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { readFileBlob } }));

beforeEach(() => { readFileBlob.mockReset(); vi.stubGlobal('Blob', NodeBlob); });
afterEach(() => vi.unstubAllGlobals());

test('relative images, scripts and styles use authenticated project reads and become self-contained', async () => {
  readFileBlob.mockImplementation(async (_project: string, path: string) => new Response(
    path.endsWith('page.html') ? '<html><head><link rel="stylesheet" href="style.css"></head><body><img src="plot.png"><script src="scene.js"></script></body></html>'
      : path.endsWith('.css') ? 'body{color:red}' : path.endsWith('.js') ? 'window.scene=1;' : 'png',
  ));
  const signal = new AbortController().signal;
  const html = await loadWorkspaceVisual('project-1', '/work/out/page.html', signal);
  assert.deepEqual(readFileBlob.mock.calls.map(call => call.slice(0, 2)), [
    ['project-1', '/work/out/page.html'], ['project-1', '/work/out/style.css'], ['project-1', '/work/out/plot.png'], ['project-1', '/work/out/scene.js'],
  ]);
  assert.match(html, /data:image\/png;base64,cG5n/);
  assert.match(html, /<style>body\{color:red\}<\/style>/);
  assert.match(html, /<script>window.scene=1;<\/script>/);
  assert.doesNotMatch(html, /src="scene\.js"/);
  assert.equal(readFileBlob.mock.calls.every(call => call[2].signal === signal), true);
});

test('external URLs do not become authenticated fetches by the parent', async () => {
  readFileBlob.mockResolvedValue(new Response('<img src="https://evil.test/image"><script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>'));
  await loadWorkspaceVisual('p', 'page.html', new AbortController().signal);
  assert.equal(readFileBlob.mock.calls.length, 1);
});

test('oversized streams are canceled before the full file is buffered', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel }));
  await assert.rejects(readPreviewBytes(response, 10, new AbortController().signal), /preview-too-large/);
  assert.equal(cancel.mock.calls.length, 1);
});

test('HTTP errors, known excessive length and aborted work never render partial data', async () => {
  const controller = new AbortController();
  await assert.rejects(readPreviewBytes(new Response('no', { status: 403 }), 10, controller.signal), /403/);
  await assert.rejects(readPreviewBytes(new Response('x', { headers: { 'Content-Length': '100' } }), 10, controller.signal), /preview-too-large/);
  controller.abort();
  await assert.rejects(readPreviewBytes(new Response('x'), 10, controller.signal), /Aborted/);
});

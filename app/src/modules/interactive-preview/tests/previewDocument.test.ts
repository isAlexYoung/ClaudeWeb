import assert from 'node:assert/strict';

import { test } from 'vitest';

import { buildPreviewDocument, readPreviewMessage } from '@/modules/interactive-preview/utils/previewDocument';

test('the host policy precedes scripts, drops source policies/bases and denies parent/network access', () => {
  const source = '<html><head><base href="https://evil.test/"><meta http-equiv="Content-Security-Policy" content="default-src *"><script>window.example=1</script></head><body><canvas></canvas></body></html>';
  const html = buildPreviewDocument(source, 'channel-1', false);
  const document = new DOMParser().parseFromString(html, 'text/html');
  assert.equal(document.head.firstElementChild?.tagName, 'META');
  assert.equal(document.querySelectorAll('meta[http-equiv]').length, 1);
  assert.equal(document.querySelector('base') === null, true);
  assert.match(document.querySelector('meta')?.content || '', /connect-src 'none'/);
  assert.match(document.querySelector('meta')?.content || '', /frame-src 'none'/);
  assert.equal(document.querySelector('canvas') !== null, true);
  assert.match(html, /data-claude-prompt/);
});

test('optional libraries are pinned by package and version, not a wildcard CDN origin', () => {
  const document = new DOMParser().parseFromString(buildPreviewDocument('<div>Chart</div>', 'channel', true), 'text/html');
  const policy = document.querySelector('meta')!.content;
  assert.match(policy, /chart\.js@4\.4\.7\/dist\/chart\.umd\.min\.js/);
  assert.match(policy, /three@0\.170\.0\//);
  assert.doesNotMatch(policy, /https:\/\/cdn\.jsdelivr\.net(?:;|\s)/);
  assert.match(policy, /worker-src 'none'/);
});

test('events need the current frame and channel, and cannot carry unbounded prompts', () => {
  const frame = {} as Window;
  const event = (data: unknown, source = frame) => ({ data, source }) as MessageEvent;
  const data = { type: 'claudeweb-visual', channel: 'current', kind: 'follow-up', text: '  Show Q3  ' };
  assert.deepEqual(readPreviewMessage(event(data), frame, 'current'), { kind: 'follow-up', text: 'Show Q3' });
  assert.equal(readPreviewMessage(event(data, {} as Window), frame, 'current'), null);
  assert.equal(readPreviewMessage(event(data), frame, 'old'), null);
  assert.equal(readPreviewMessage(event({ ...data, text: 'x'.repeat(2001) }), frame, 'current'), null);
  assert.equal(readPreviewMessage(event({ ...data, kind: 'execute-tool' }), frame, 'current'), null);
  assert.equal(readPreviewMessage(event(data), null, 'current'), null);
  assert.equal(readPreviewMessage(event({ ...data, kind: 'error', text: 'x'.repeat(10000) }), frame, 'current')?.text.length, 500);
});

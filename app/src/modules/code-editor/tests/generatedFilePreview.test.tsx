import assert from 'node:assert/strict';
import { Blob as NodeBlob } from 'node:buffer';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import GeneratedFilePreview from '@/modules/code-editor/GeneratedFilePreview';
import { i18n } from '@/modules/i18n';

const { readFileBlob } = vi.hoisted(() => ({ readFileBlob: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { readFileBlob }, readApiErrorMessage: (value: any) => value?.error?.message }));
vi.mock('@/modules/code-editor/markdown/MarkdownPreview', () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));
const file = { name: 'result.html', path: '/work/result.html', projectId: 'project-1' };
const revoke = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage('en');
  readFileBlob.mockReset(); revoke.mockClear();
  vi.stubGlobal('Blob', NodeBlob);
  URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = revoke;
});
afterEach(() => vi.unstubAllGlobals());

test('HTML runs in an opaque sandbox with no network or parent access; follow-up edits use the original path', async () => {
  readFileBlob.mockResolvedValue(new Response('<h1>Report</h1><script>window.test=1</script>'));
  const continueEditing = vi.fn(), source = vi.fn();
  const view = render(<GeneratedFilePreview file={file} onClose={vi.fn()} onContinueEditing={continueEditing} onOpenSource={source} />);
  await waitFor(() => assert.ok(view.container.querySelector('iframe')));
  const frame = view.container.querySelector('iframe')!;
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.match(frame.srcdoc, /connect-src 'none'/);
  assert.match(frame.srcdoc, /<h1>Report<\/h1>/);
  fireEvent.click(view.getByRole('button', { name: 'Continue editing' }));
  assert.deepEqual(continueEditing.mock.calls, [[file.path]]);
  fireEvent.click(view.getByRole('button', { name: 'View source' }));
  assert.deepEqual(source.mock.calls, [[file.path]]);
  assert.deepEqual(readFileBlob.mock.calls[0].slice(0, 2), ['project-1', file.path]);
  view.unmount(); assert.ok(revoke.mock.calls.some(([url]) => url === 'blob:preview'));
});

test('image preview pins its MIME type, downloads original bytes and refreshes after a revision', async () => {
  readFileBlob.mockImplementation(async () => new Response('image bytes', { headers: { 'Content-Type': 'text/html' } }));
  const createUrl = vi.mocked(URL.createObjectURL);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const view = render(<GeneratedFilePreview file={{ ...file, name: 'image.png', path: '/work/image.png' }} onClose={vi.fn()} />);
  await view.findByRole('img');
  assert.equal((createUrl.mock.calls[0][0] as Blob).type, 'image/png');
  fireEvent.click(view.getByRole('button', { name: 'Download' }));
  await waitFor(() => assert.equal(click.mock.calls.length, 1));
  assert.equal((click.mock.contexts[0] as HTMLAnchorElement).download, 'image.png');
  assert.equal((click.mock.contexts[0] as HTMLAnchorElement).href, 'blob:preview');
  fireEvent.click(view.getByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => assert.equal(readFileBlob.mock.calls.length, 2));
  await view.findByRole('img');
  click.mockRestore();
});

test('PDF extension cannot embed an HTML response and HTTP permission errors remain visible', async () => {
  readFileBlob.mockResolvedValue(new Response('<html>not a pdf</html>'));
  const view = render(<GeneratedFilePreview file={{ ...file, name: 'result.pdf' }} onClose={vi.fn()} />);
  assert.match((await view.findByRole('alert')).textContent || '', /not a valid PDF/);
  assert.equal(view.container.querySelector('iframe'), null);
  assert.equal((view.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled, true);
  readFileBlob.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Permission denied' } }), { status: 403 }));
  fireEvent.click(view.getByRole('button', { name: 'Refresh preview' }));
  await waitFor(() => assert.match(view.getByRole('alert').textContent || '', /Permission denied/));
});

test('unsupported office documents keep download available without rendering arbitrary bytes', async () => {
  readFileBlob.mockResolvedValue(new Response('office bytes'));
  const view = render(<GeneratedFilePreview file={{ ...file, name: 'slides.pptx' }} onClose={vi.fn()} />);
  await view.findByText(/Online preview is unavailable/);
  assert.equal((view.getByRole('button', { name: 'Download' }) as HTMLButtonElement).disabled, false);
  assert.equal(view.container.querySelector('iframe'), null);
});

test('a valid PDF is opened by the native PDF viewer with a pinned MIME type', async () => {
  readFileBlob.mockResolvedValue(new Response('%PDF-1.4\n%%EOF', { headers: { 'Content-Type': 'application/octet-stream' } }));
  const view = render(<GeneratedFilePreview file={{ ...file, name: 'report.pdf' }} onClose={vi.fn()} />);
  await waitFor(() => assert.ok(view.container.querySelector('iframe')));
  assert.equal(view.container.querySelector('iframe')?.getAttribute('src'), 'blob:preview');
  assert.equal((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type, 'application/pdf');
});

import assert from 'node:assert/strict';

import { Suspense } from 'react';
import { render } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ArtefactSummary } from '@/shared/types';
import ArtefactEditor from '@/modules/artefacts/ArtefactEditor';
import ArtefactSessionCard from '@/modules/artefacts/ArtefactSessionCard';
import { SheetConversationEmptyState } from '@/modules/artefacts/sheet/SheetConversation';
import { artefactDownload, fileBaseName } from '@/modules/artefacts/editor/download';

const harness = vi.hoisted(() => ({
  open: vi.fn(),
}));

vi.mock('@/shared/api', () => ({
  api: { artefacts: { open: harness.open, list: vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }))) } },
  readApiErrorMessage: () => null,
}));

// The real editors pull in FortuneSheet, Tiptap and Excalidraw; the dispatcher only needs to pick one.
vi.mock('@/modules/artefacts/sheet/SpreadsheetEditor', () => ({ default: () => <p>spreadsheet editor</p> }));
vi.mock('@/modules/artefacts/doc/DocumentEditor', () => ({ default: () => <p>document editor</p> }));
vi.mock('@/modules/artefacts/whiteboard/WhiteboardEditor', () => ({ default: () => <p>whiteboard editor</p> }));

const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

const readBytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(blob);
});

const editorProps = (artefactId: string) => ({ artefactId, onClose: vi.fn(), onOpenSession: vi.fn() });

const card = (kind: ArtefactSummary['kind']): ArtefactSummary => ({
  id: `${kind}-1`,
  kind,
  title: 'Launch',
  sessionId: 'session-1',
  pinned: false,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
  openedAt: '2026-11-24T00:00:00.000Z',
});

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  harness.open.mockReset();
});

test('the editor for the artefact kind the caller knows is shown', async () => {
  const doc = render(<Suspense fallback={null}><ArtefactEditor {...editorProps('a')} kind="doc" /></Suspense>);
  await doc.findByText('document editor');
  doc.unmount();

  const board = render(<Suspense fallback={null}><ArtefactEditor {...editorProps('b')} kind="whiteboard" /></Suspense>);
  await board.findByText('whiteboard editor');
  board.unmount();

  const sheet = render(<Suspense fallback={null}><ArtefactEditor {...editorProps('c')} kind="sheet" /></Suspense>);
  await sheet.findByText('spreadsheet editor');
  assert.equal(harness.open.mock.calls.length, 0, 'a known kind is not looked up');
});

test('an artefact of unknown kind is looked up once; kinds without an editor say so', async () => {
  harness.open.mockImplementation(async () => new Response(JSON.stringify({ success: true, data: { id: 'x', kind: 'whiteboard' } })));
  const view = render(<Suspense fallback={null}><ArtefactEditor {...editorProps('x')} /></Suspense>);
  assert.notEqual(view.queryByRole('status'), null, 'loading while it is looked up');
  await view.findByText('whiteboard editor');
  assert.deepEqual(harness.open.mock.calls, [['x']]);
  view.unmount();

  const slides = render(<ArtefactEditor {...editorProps('s')} kind="slides" />);
  assert.equal(slides.getByRole('alert').textContent, 'Slides is coming soon.');
});

test('the empty conversation asks the question for each kind and offers its suggestions', () => {
  const onSelectSuggestion = vi.fn();
  const doc = render(<SheetConversationEmptyState kind="doc" onSelectSuggestion={onSelectSuggestion} />);
  doc.getByRole('heading', { name: 'What should this document say?' });
  doc.getByRole('button', { name: 'Meeting notes with decisions and action items' }).click();
  assert.deepEqual(onSelectSuggestion.mock.calls, [['Meeting notes with decisions and action items']]);
  doc.unmount();

  const board = render(<SheetConversationEmptyState kind="whiteboard" onSelectSuggestion={onSelectSuggestion} />);
  board.getByRole('heading', { name: 'What should we draw?' });
  assert.equal(board.container.querySelectorAll('.artefact-kind-whiteboard').length, 1);
  assert.notEqual(board.queryByRole('button', { name: 'A mind map for planning a product launch' }), null);
});

test('the session card offers the download for each editable kind', () => {
  const doc = render(<ArtefactSessionCard artefact={card('doc')} onOpen={vi.fn()} />);
  assert.notEqual(doc.queryByRole('button', { name: 'Download Markdown' }), null);
  doc.unmount();

  const board = render(<ArtefactSessionCard artefact={card('whiteboard')} onOpen={vi.fn()} />);
  assert.notEqual(board.queryByRole('button', { name: 'Download .excalidraw' }), null);
  board.unmount();

  const slides = render(<ArtefactSessionCard artefact={card('slides')} onOpen={vi.fn()} />);
  assert.equal(slides.queryByRole('button', { name: /^Download/ }), null);
});

test('downloads are named after the title and hold the file in its own format', async () => {
  assert.equal(fileBaseName(' Q3: plan/draft? '), 'Q3  plan draft');
  assert.equal(fileBaseName(' <> '), 'Untitled');

  const markdown = artefactDownload({ kind: 'doc', title: 'Notes', content: '# Notes\n\n- one\n' });
  assert.equal(markdown?.filename, 'Notes.md');
  assert.equal(await readBlob(markdown!.blob), '# Notes\n\n- one\n');

  const scene = { type: 'excalidraw' as const, version: 2, elements: [{ id: 'a', type: 'rectangle' }] };
  const board = artefactDownload({ kind: 'whiteboard', title: 'Flow', content: scene });
  assert.equal(board?.filename, 'Flow.excalidraw');
  assert.deepEqual(JSON.parse(await readBlob(board!.blob)), scene);

  const sheet = artefactDownload({
    kind: 'sheet',
    title: 'Budget',
    content: { format: 'claudeweb-sheet@1', sheets: [{ name: 'Sheet1', cells: { A1: 'Rent', B1: 900 } }] } as never,
  });
  assert.equal(sheet?.filename, 'Budget.csv');
  const csv = await readBlob(sheet!.blob);
  assert.match(csv, /Rent,900/);
  assert.deepEqual([...(await readBytes(sheet!.blob)).slice(0, 3)], [0xef, 0xbb, 0xbf], 'the byte order mark lets Excel read it as UTF-8');

  assert.equal(artefactDownload({ kind: 'doc', title: 'x', content: null }), null);
  assert.equal(artefactDownload({ kind: 'slides', title: 'x', content: 'anything' }), null);
});

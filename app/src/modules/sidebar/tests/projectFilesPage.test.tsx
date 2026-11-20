import assert from 'node:assert/strict';

import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import ProjectFilesPage from '@/modules/sidebar/ProjectFilesPage';
import { fileTypeLabel } from '@/modules/sidebar/utils/projectFiles';

const assets = vi.hoisted(() => ({
  projectFiles: vi.fn(),
  downloadProjectFile: vi.fn(),
  deleteProjectFile: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { assets },
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const FILES = [
  {
    storedName: '1763000000000-1-report.pdf', name: '季度 report.pdf', path: '/home/u/.cloudcli/assets/1763000000000-1-report.pdf',
    size: 3 * 1024 * 1024, mimeType: 'application/pdf', sessionId: 's1', uploadedAt: '2026-11-16T08:00:00Z', exists: true,
  },
  {
    storedName: '1763000000000-2-gone.txt', name: 'gone.txt', path: '/home/u/.cloudcli/assets/1763000000000-2-gone.txt',
    size: 12, mimeType: 'text/plain', sessionId: null, uploadedAt: '2026-11-15T08:00:00Z', exists: false,
  },
];

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  for (const mock of Object.values(assets)) mock.mockReset();
  assets.projectFiles.mockImplementation(async () => json({ files: FILES }));
  assets.deleteProjectFile.mockImplementation(async () => json({ deleted: true }));
});

test('the page lists the project uploads with path, size and type', async () => {
  const view = render(<ProjectFilesPage project={{ name: 'Website', path: '/srv/website' }} onClose={() => {}} />);
  const page = view.getByRole('dialog', { name: 'File management · Website' });
  await within(page).findByText('季度 report.pdf');

  assert.deepEqual(assets.projectFiles.mock.calls, [['/srv/website']]);
  assert.ok(within(page).getByText('2 uploaded files, 3.0 MB on the server.', { exact: false }));
  assert.ok(within(page).getByText(FILES[0].path));
  assert.ok(within(page).getByText('PDF'));
  assert.ok(within(page).getByText('No longer on the server'));
  // A file that is gone can still be removed from the list, but not downloaded.
  assert.equal((within(page).getByRole('button', { name: 'Download gone.txt' }) as HTMLButtonElement).disabled, true);
  assert.equal((within(page).getByRole('button', { name: 'Download 季度 report.pdf' }) as HTMLButtonElement).disabled, false);
});

test('deleting asks first, then removes the file from the list', async () => {
  const view = render(<ProjectFilesPage project={{ name: 'Website', path: '/srv/website' }} onClose={() => {}} />);
  await view.findByText('gone.txt');

  fireEvent.click(view.getByRole('button', { name: 'Delete gone.txt' }));
  assert.equal(assets.deleteProjectFile.mock.calls.length, 0);
  const confirm = view.getByRole('dialog', { name: 'Delete file?' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

  // A boolean, not the element: printing a jsdom node on every retry exhausts the worker's memory.
  await waitFor(() => assert.equal(view.queryByText('gone.txt') === null, true));
  assert.deepEqual(assets.deleteProjectFile.mock.calls, [['1763000000000-2-gone.txt']]);
});

test('an empty project says so, and Escape closes the page', async () => {
  assets.projectFiles.mockImplementation(async () => json({ files: [] }));
  const onClose = vi.fn();
  const view = render(<ProjectFilesPage project={{ name: 'Website', path: '/srv/website' }} onClose={onClose} />);
  await view.findByText('No files have been uploaded in this project yet.');
  fireEvent.keyDown(window, { key: 'Escape' });
  assert.equal(onClose.mock.calls.length, 1);
});

test('the type column comes from the extension, or the MIME type without one', () => {
  assert.equal(fileTypeLabel({ name: 'photo.jpeg', mimeType: 'image/jpeg' }), 'JPEG');
  assert.equal(fileTypeLabel({ name: 'Makefile', mimeType: 'text/plain' }), 'text/plain');
  assert.equal(fileTypeLabel({ name: 'blob', mimeType: null }), '—');
});

test('a late response from the previous project cannot replace the current list', async () => {
  let finishOld!: (value: Response) => void;
  assets.projectFiles.mockImplementation((projectPath: string) => (
    projectPath === '/srv/old' ? new Promise<Response>((resolve) => { finishOld = resolve; }) : Promise.resolve(json({ files: [] }))
  ));
  const view = render(<ProjectFilesPage project={{ name: 'Old', path: '/srv/old' }} onClose={() => {}} />);
  view.rerender(<ProjectFilesPage project={{ name: 'New', path: '/srv/new' }} onClose={() => {}} />);
  await view.findByText('No files have been uploaded in this project yet.');
  finishOld(json({ files: FILES }));
  await waitFor(() => assert.equal(view.queryByText('gone.txt') === null, true));
  assert.equal(view.getByRole('dialog').getAttribute('aria-label'), 'File management · New');
});

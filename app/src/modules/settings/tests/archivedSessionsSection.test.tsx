import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import ArchivedSessionsSection from '@/modules/settings/tabs/tasks-settings/ArchivedSessionsSection';

/** Settings > Tasks and sessions lists the archive the sidebar no longer shows: unarchive, or delete for good. */

const api = vi.hoisted(() => ({
  archivedProjects: vi.fn(),
  getArchivedSessions: vi.fn(),
  restoreSession: vi.fn(),
  restoreProject: vi.fn(),
  deleteSession: vi.fn(),
  deleteProject: vi.fn(),
}));
vi.mock('@/shared/api', () => ({ api: { ...api, user: { savePreferences: async () => ({ ok: true }) } } }));

const json = (value: unknown) => Promise.resolve({ ok: true, json: async () => value });
let archived = ['s1', 's2'];
let archivedProjects = ['p9'];

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  archived = ['s1', 's2'];
  archivedProjects = ['p9'];
  for (const fn of Object.values(api)) fn.mockReset();
  api.archivedProjects.mockImplementation(() => json({ data: { projects: archivedProjects.map((id) => ({ projectId: id, displayName: 'Old project', isArchived: true })) } }));
  api.getArchivedSessions.mockImplementation(() => json({ data: { sessions: archived.map((id) => ({
    sessionId: id, sessionTitle: `Chat ${id}`, projectDisplayName: 'claudeweb', projectId: 'p1', provider: 'claude',
  })) } }));
  api.restoreSession.mockImplementation((id: string) => { archived = archived.filter((item) => item !== id); return json({ success: true }); });
  api.deleteSession.mockImplementation((id: string) => { archived = archived.filter((item) => item !== id); return json({ success: true }); });
  api.restoreProject.mockImplementation(() => json({ success: true }));
  api.deleteProject.mockImplementation((id: string) => { archivedProjects = archivedProjects.filter((item) => item !== id); return json({ success: true }); });
});

test('archived sessions and projects are listed; unarchiving one refreshes the list and the sidebar', async () => {
  const onChanged = vi.fn();
  render(<ArchivedSessionsSection onChanged={onChanged} />);
  await screen.findByText('Chat s1');
  assert.ok(screen.getByText('Chat s2'));
  assert.ok(screen.getByText('Old project'));

  const row = screen.getByText('Chat s1').closest('.settings-archive-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Unarchive' }));
  await waitFor(() => assert.equal(screen.queryByText('Chat s1') === null, true));
  assert.deepEqual(api.restoreSession.mock.calls, [['s1']]);
  assert.equal(onChanged.mock.calls.length, 1);
});

test('delete asks first, then deletes the session for good', async () => {
  const onChanged = vi.fn();
  render(<ArchivedSessionsSection onChanged={onChanged} />);
  await screen.findByText('Chat s2');

  const row = screen.getByText('Chat s2').closest('.settings-archive-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  assert.equal(api.deleteSession.mock.calls.length, 0, 'nothing is deleted before confirming');
  const dialog = await screen.findByRole('dialog');
  assert.match(dialog.textContent || '', /Chat s2/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

  await waitFor(() => assert.equal(screen.queryByText('Chat s2') === null, true));
  assert.deepEqual(api.deleteSession.mock.calls, [['s2', true]]);
  assert.equal(onChanged.mock.calls.length, 1);
});

test('an empty archive says so', async () => {
  archived = [];
  api.archivedProjects.mockImplementation(() => json({ data: { projects: [] } }));
  render(<ArchivedSessionsSection />);
  await screen.findByText('Nothing is archived.');
});

test('an archived project, even an empty one, can be deleted after a confirmation that keeps its folder', async () => {
  const onChanged = vi.fn();
  render(<ArchivedSessionsSection onChanged={onChanged} />);
  const row = (await screen.findByText('Old project')).closest('.settings-archive-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
  assert.equal(api.deleteProject.mock.calls.length, 0, 'nothing is deleted before confirming');
  const dialog = await screen.findByRole('dialog');
  assert.match(dialog.textContent || '', /Old project/);
  assert.match(dialog.textContent || '', /folder and its files are not touched/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

  await waitFor(() => assert.equal(screen.queryByText('Old project') === null, true));
  assert.deepEqual(api.deleteProject.mock.calls, [['p9', true]]);
  assert.equal(api.deleteSession.mock.calls.length, 0);
  assert.equal(onChanged.mock.calls.length, 1);
});

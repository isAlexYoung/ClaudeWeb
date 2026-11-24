import assert from 'node:assert/strict';

import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ArtefactSummary } from '@/shared/types';
import ArtefactsPage from '@/modules/artefacts/ArtefactsPage';

const harness = vi.hoisted(() => ({
  artefacts: [] as unknown[],
  api: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: status < 400, data }), { status });

vi.mock('@/shared/api', () => ({
  api: { artefacts: harness.api },
  readApiErrorMessage: () => null,
}));

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const summary = (fields: Partial<ArtefactSummary> & { id: string; title: string }): ArtefactSummary => ({
  kind: 'sheet',
  sessionId: null,
  pinned: false,
  createdAt: ago(DAY),
  updatedAt: ago(DAY),
  openedAt: ago(DAY),
  ...fields,
});

const BUDGET = summary({ id: 'budget', title: 'Monthly budget', sessionId: 'session-1', openedAt: ago(5 * MINUTE), createdAt: ago(10 * DAY) });
const REVIEW = summary({ id: 'review', title: 'Annual review', kind: 'doc', openedAt: ago(2 * DAY), createdAt: ago(DAY) });
const PLAN = summary({ id: 'plan', title: 'Alpha plan', pinned: true, openedAt: ago(40 * DAY), createdAt: ago(40 * DAY) });

const renderPage = () => {
  const props = { onOpenArtefact: vi.fn(), onOpenSession: vi.fn(), onNewChat: vi.fn() };
  const view = render(<ArtefactsPage {...props} />);
  return { view, props };
};

/** The titles shown, in order, in whichever view is on. */
const titles = (container: HTMLElement) => [...container.querySelectorAll('.artefact-card-title, .artefact-row-title')].map((node) => node.textContent);

const openFilter = (view: ReturnType<typeof render>) => fireEvent.click(view.getByRole('button', { name: 'Filter' }));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  localStorage.clear();
  harness.artefacts = [BUDGET, REVIEW, PLAN];
  harness.api.list.mockReset().mockImplementation(async () => json(harness.artefacts));
  harness.api.create.mockReset();
  harness.api.update.mockReset().mockImplementation(async () => json({}));
  harness.api.remove.mockReset().mockImplementation(async () => json(null));
});

test('artefacts are listed pinned first, then by when they were last opened', async () => {
  const { view } = renderPage();
  await view.findByRole('list', { name: 'Artefacts' });
  assert.deepEqual(titles(view.container), ['Alpha plan', 'Monthly budget', 'Annual review']);
  const card = view.getByRole('button', { name: 'Monthly budget' });
  assert.match(card.textContent ?? '', /Spreadsheet · 5 minutes ago/);
});

test('search narrows the list by title and clearing it brings everything back', async () => {
  const { view } = renderPage();
  await view.findByRole('list', { name: 'Artefacts' });
  fireEvent.click(view.getByRole('button', { name: 'Search' }));
  fireEvent.change(view.getByRole('searchbox', { name: 'Search' }), { target: { value: 'BUDGET' } });
  assert.deepEqual(titles(view.container), ['Monthly budget']);
  fireEvent.change(view.getByRole('searchbox', { name: 'Search' }), { target: { value: 'nothing like it' } });
  assert.notEqual(view.queryByText('No artefacts match these filters.'), null);
  fireEvent.click(view.getByRole('button', { name: 'Clear search' }));
  assert.equal(view.queryByRole('searchbox'), null);
  assert.equal(titles(view.container).length, 3);
});

test('the filter menu sorts, filters by type with counts, by opened date and to pinned ones', async () => {
  const { view } = renderPage();
  await view.findByRole('list', { name: 'Artefacts' });
  openFilter(view);

  fireEvent.click(view.getByRole('menuitem', { name: /^Sort by/ }));
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Name' }));
  assert.deepEqual(titles(view.container), ['Alpha plan', 'Annual review', 'Monthly budget'], 'pinned still leads');
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Last opened' }));

  fireEvent.click(view.getByRole('menuitem', { name: /^Type/ }));
  const sheets = view.getByRole('menuitemcheckbox', { name: /^Spreadsheet/ });
  assert.match(sheets.textContent ?? '', /2$/);
  assert.match(view.getByRole('menuitemcheckbox', { name: /^Document/ }).textContent ?? '', /1$/);
  assert.match(view.getByRole('menuitemcheckbox', { name: /^Whiteboard/ }).textContent ?? '', /0$/);
  fireEvent.click(view.getByRole('menuitemcheckbox', { name: /^Document/ }));
  assert.equal(view.getByRole('menuitemcheckbox', { name: /^Document/ }).getAttribute('aria-checked'), 'true');
  assert.deepEqual(titles(view.container), ['Annual review']);
  fireEvent.click(sheets);
  assert.deepEqual(titles(view.container), ['Alpha plan', 'Monthly budget', 'Annual review']);
  fireEvent.click(sheets);
  fireEvent.click(view.getByRole('menuitemcheckbox', { name: /^Document/ }));

  fireEvent.click(view.getByRole('menuitem', { name: /^Opened/ }));
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Past 7 days' }));
  assert.deepEqual(titles(view.container), ['Monthly budget', 'Annual review']);
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Any time' }));

  fireEvent.click(view.getByRole('menuitemradio', { name: 'Pinned' }));
  assert.deepEqual(titles(view.container), ['Alpha plan']);
});

test('the list view is remembered for the next visit', async () => {
  const first = renderPage();
  await first.view.findByRole('list', { name: 'Artefacts' });
  fireEvent.click(first.view.getByRole('button', { name: 'List view' }));
  assert.equal(first.view.container.querySelectorAll('.artefact-row').length, 3);
  assert.match(first.view.container.querySelector('.artefact-row')!.textContent ?? '', /Opened /);
  first.view.unmount();

  const second = renderPage();
  await second.view.findByRole('list', { name: 'Artefacts' });
  assert.equal(second.view.container.querySelectorAll('.artefact-row').length, 3);
  assert.notEqual(second.view.queryByRole('button', { name: 'Grid view' }), null);
});

test('New → Spreadsheet creates an untitled spreadsheet and opens it; the other kinds are coming soon', async () => {
  harness.api.create.mockImplementation(async () => json(summary({ id: 'new-sheet', title: 'Untitled' })));
  const { view, props } = renderPage();
  await view.findByRole('list', { name: 'Artefacts' });

  fireEvent.click(view.getByRole('button', { name: 'New' }));
  fireEvent.click(view.getByRole('menuitem', { name: /^Document/ }));
  assert.equal((await view.findByRole('status')).textContent, 'Document is coming soon.');
  assert.equal(harness.api.create.mock.calls.length, 0);

  fireEvent.click(view.getByRole('button', { name: 'New' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'Chat' }));
  assert.equal(props.onNewChat.mock.calls.length, 1);

  fireEvent.click(view.getByRole('button', { name: 'New' }));
  fireEvent.click(view.getByRole('menuitem', { name: /^Spreadsheet/ }));
  await waitFor(() => assert.deepEqual(props.onOpenArtefact.mock.calls, [['new-sheet']]));
  assert.deepEqual(harness.api.create.mock.calls, [[{ kind: 'sheet', title: 'Untitled' }]]);
});

test('a card can be opened, pinned, renamed, followed to its conversation and deleted', async () => {
  const { view, props } = renderPage();
  await view.findByRole('list', { name: 'Artefacts' });
  const card = view.getByRole('button', { name: 'Monthly budget' }).closest('li') as HTMLElement;

  fireEvent.click(within(card).getByRole('button', { name: 'Monthly budget' }));
  assert.deepEqual(props.onOpenArtefact.mock.calls, [['budget']]);

  fireEvent.click(within(card).getByRole('button', { name: 'Pin' }));
  await waitFor(() => assert.deepEqual(harness.api.update.mock.calls, [['budget', { pinned: true }]]));

  fireEvent.click(within(card).getByRole('button', { name: 'Options for Monthly budget' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'View conversation' }));
  assert.deepEqual(props.onOpenSession.mock.calls, [['session-1']]);

  fireEvent.click(within(card).getByRole('button', { name: 'Options for Monthly budget' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'Rename' }));
  const input = view.getByRole('textbox', { name: 'Rename' });
  fireEvent.change(input, { target: { value: '  Household budget ' } });
  fireEvent.click(view.getByRole('button', { name: 'Save' }));
  await waitFor(() => assert.deepEqual(harness.api.update.mock.calls.at(-1), ['budget', { title: 'Household budget' }]));

  fireEvent.click(within(card).getByRole('button', { name: 'Options for Monthly budget' }));
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  const dialog = view.getByRole('dialog', { name: 'Delete artefact?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  await waitFor(() => assert.deepEqual(harness.api.remove.mock.calls, [['budget']]));

  // A document has no conversation yet, so its menu does not offer one.
  const review = view.getByRole('button', { name: 'Annual review' }).closest('li') as HTMLElement;
  fireEvent.click(within(review).getByRole('button', { name: 'Options for Annual review' }));
  assert.equal(view.queryByRole('menuitem', { name: 'View conversation' }), null);
});

test('with nothing yet the page shows the empty state under the create tiles', async () => {
  harness.artefacts = [];
  const { view } = renderPage();
  await view.findByText('Your artefacts live here');
  assert.equal(view.queryByRole('list', { name: 'Artefacts' }), null);
  assert.equal(view.getByRole('heading', { name: 'Create new' }).tagName, 'H2');
  assert.equal(view.container.querySelectorAll('.artefacts-tile').length, 7);
});

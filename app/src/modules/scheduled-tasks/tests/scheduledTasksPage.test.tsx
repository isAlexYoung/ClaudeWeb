import assert from 'node:assert/strict';

import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ScheduledTask } from '@/shared/types';
import ScheduledTasksPage from '@/modules/scheduled-tasks/ScheduledTasksPage';

const harness = vi.hoisted(() => ({
  tasks: [] as unknown[],
  listeners: [] as Array<(event: { kind?: string }) => void>,
  api: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    runNow: vi.fn(),
    projects: vi.fn(),
    models: vi.fn(),
  },
}));

const json = (body: unknown, ok = true) => ({ ok, statusText: ok ? 'OK' : 'Bad Request', json: async () => body }) as Response;

vi.mock('@/shared/api', () => ({
  api: {
    scheduledTasks: {
      list: harness.api.list,
      create: harness.api.create,
      update: harness.api.update,
      remove: harness.api.remove,
      runNow: harness.api.runNow,
    },
    projects: harness.api.projects,
    providers: { models: harness.api.models },
  },
}));
vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    subscribe: (listener: (event: { kind?: string }) => void) => {
      harness.listeners.push(listener);
      return () => { harness.listeners = harness.listeners.filter((entry) => entry !== listener); };
    },
  }),
}));

const TASK: ScheduledTask = {
  id: 'task-1',
  name: 'Morning report',
  projectPath: '/home/claudeweb',
  prompt: 'Summarise yesterday',
  schedule: { kind: 'daily', time: '09:00' },
  timezone: 'UTC',
  model: null,
  permission: 'edits',
  enabled: true,
  nextRunAt: '2026-11-16T09:00:00.000Z',
  lastRunAt: '2026-11-15T09:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  runs: [{
    id: 'run-1', sessionId: 'session-9', source: 'schedule', status: 'failed', error: 'Not allowed in an unattended run',
    startedAt: '2026-11-15T09:00:00.000Z', finishedAt: '2026-11-15T09:01:00.000Z',
  }],
};

/** A one-off task that already ran and switched itself off. */
const FINISHED: ScheduledTask = {
  ...TASK,
  id: 'task-2',
  name: 'Release notes',
  projectPath: '/srv/website',
  prompt: 'Write the release notes',
  schedule: { kind: 'once', at: '2026-11-10T09:00:00.000Z' },
  enabled: false,
  nextRunAt: null,
  runs: [{ ...TASK.runs[0], id: 'run-2', status: 'succeeded', error: null }],
};

const MODELS = ['Fable 5.2', 'Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Opus 5', 'Sonnet 5'].map((label) => ({
  value: label.toLowerCase().replace(/\s+/g, '-'),
  label,
}));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  harness.tasks = [TASK];
  harness.listeners = [];
  for (const mock of Object.values(harness.api)) mock.mockReset();
  harness.api.list.mockImplementation(async () => json({ success: true, data: harness.tasks }));
  harness.api.runNow.mockImplementation(async () => json({ success: true, data: { queued: true } }));
  harness.api.update.mockImplementation(async () => json({ success: true, data: TASK }));
  harness.api.create.mockImplementation(async () => json({ success: true, data: TASK }));
  harness.api.projects.mockImplementation(async () => json([
    { projectId: 'p1', displayName: 'Website', fullPath: '/srv/website' },
    { projectId: 'chat', displayName: 'Chat', fullPath: '/home/claudeweb' },
  ]));
  harness.api.models.mockImplementation(async () => json({
    success: true,
    data: { models: [{ value: 'default', label: 'Default (recommended)' }, ...MODELS] },
  }));
});

const renderPage = (onStartChat = vi.fn(), onOpenSession = vi.fn()) => ({
  view: render(<ScheduledTasksPage onOpenSession={onOpenSession} onStartChat={onStartChat} />),
  onStartChat,
  onOpenSession,
});

/** Opens New task ▾ and picks "Set up manually", returning the dialog. */
async function openManualEditor(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole('button', { name: 'New task' }));
  fireEvent.click(await view.findByRole('menuitem', { name: 'Set up manually' }));
  return view.findByRole('dialog');
}

test('the page shows the big title, the My tasks and Templates tabs, and lists tasks with history', async () => {
  const { view, onOpenSession } = renderPage();
  assert.ok(view.getByRole('heading', { level: 1, name: 'Scheduled tasks' }));
  assert.equal(view.getByRole('tab', { name: 'My tasks' }).getAttribute('aria-selected'), 'true');
  assert.ok(view.getByRole('tab', { name: 'Templates' }));

  const card = (await view.findByText('Morning report')).closest('li') as HTMLElement;
  assert.match(card.textContent ?? '', /Every day at 09:00/);
  assert.match(card.textContent ?? '', /Chat \(no project\)/);
  assert.match(card.textContent ?? '', /Auto/);
  assert.match(card.textContent ?? '', /Failed/);

  fireEvent.click(within(card).getByRole('button', { name: '1 run' }));
  assert.ok(within(card).getByText('Not allowed in an unattended run'));
  fireEvent.click(within(card).getByText('Failed', { selector: '.scheduled-task-history span' }).closest('button') as HTMLElement);
  assert.deepEqual(onOpenSession.mock.calls, [['session-9']]);
});

test('run now and pause go to the server, and a change announcement reloads the list', async () => {
  const { view } = renderPage();
  await view.findByText('Morning report');

  fireEvent.click(view.getByRole('button', { name: 'Run now' }));
  await waitFor(() => assert.deepEqual(harness.api.runNow.mock.calls, [['task-1']]));

  fireEvent.click(view.getByRole('button', { name: 'Pause' }));
  await waitFor(() => assert.equal(harness.api.update.mock.calls.length, 1));
  const [, body] = harness.api.update.mock.calls[0];
  assert.equal(body.enabled, false);
  assert.equal('toolsSettings' in body, false, 'pausing keeps the saved tool lists');

  const before = harness.api.list.mock.calls.length;
  harness.tasks = [];
  act(() => { for (const listener of harness.listeners) listener({ kind: 'scheduled_tasks_changed' }); });
  await view.findByText('No scheduled tasks yet.');
  assert.ok(harness.api.list.mock.calls.length > before);
});

test('with no tasks, the empty state offers manual setup and the templates sit below it', async () => {
  harness.tasks = [];
  const { view, onStartChat } = renderPage();
  await view.findByText('No scheduled tasks yet.');
  assert.ok(view.getByRole('button', { name: 'Set up manually' }));

  fireEvent.click(view.getByRole('button', { name: /Daily briefing/ }));
  assert.equal(onStartChat.mock.calls.length, 1);
  assert.match(onStartChat.mock.calls[0][0], /"Daily briefing" \(Weekdays 08:00\)/);
});

test('the Templates tab shows only templates and each opens a chat with its own prompt', async () => {
  const { view, onStartChat } = renderPage();
  await view.findByText('Morning report');
  fireEvent.click(view.getByRole('tab', { name: 'Templates' }));
  assert.equal(view.queryByText('Morning report'), null);
  assert.equal(view.queryByRole('button', { name: 'Search scheduled tasks…' }), null, 'search belongs to My tasks');
  const templates = within(view.getByRole('list', { name: 'Templates' })).getAllByRole('button');
  assert.equal(templates.length, 6);

  fireEvent.click(view.getByRole('button', { name: /Weekly review/ }));
  assert.match(onStartChat.mock.calls[0][0], /"Weekly review" \(Every Fri at 16:00\)/);
});

test('"Create with Claude" and the editor\'s "Set up with Claude instead" open a chat asking for the details', async () => {
  const { view, onStartChat } = renderPage();
  await view.findByText('Morning report');
  fireEvent.click(view.getByRole('button', { name: 'New task' }));
  fireEvent.click(await view.findByRole('menuitem', { name: 'Create with Claude' }));
  const askForDetails = 'Help me set up a scheduled task. Ask me what it should do, how often it should run and at what time, then create it.';
  assert.deepEqual(onStartChat.mock.calls, [[askForDetails]]);

  const dialog = await openManualEditor(view);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Set up with Claude instead' }));
  assert.deepEqual(onStartChat.mock.calls[1], [askForDetails]);
});

test('the editor creates a weekly task in a project with the chosen model and permission', async () => {
  harness.tasks = [];
  const { view } = renderPage();
  await view.findByText('No scheduled tasks yet.');
  const dialog = await openManualEditor(view);
  assert.ok(within(dialog).getByText('New scheduled task'));

  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Weekly cleanup' } });
  fireEvent.change(within(dialog).getByLabelText('Instructions'), { target: { value: 'Tidy the logs' } });

  // Trigger: Scheduled ▾ · Every day ▾ → Weekly, then Monday (default) plus Friday.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Repeat' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: 'Weekly' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fri' }));

  // Model: the first four models are listed directly, the rest under "More models".
  await waitFor(() => harness.api.models.mock.calls.length > 0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Model' }));
  const modelMenu = await view.findByRole('menu', { name: 'Model' });
  assert.ok(within(modelMenu).getByRole('menuitemradio', { name: 'Default model' }));
  assert.ok(within(modelMenu).getByRole('menuitemradio', { name: 'Haiku 5.5' }));
  assert.equal(within(modelMenu).queryByRole('menuitemradio', { name: 'Opus 5' }), null);
  fireEvent.click(within(modelMenu).getByRole('menuitem', { name: 'More models' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: 'Opus 5' }));

  // Permission: Manual / Auto / Skip all approvals.
  fireEvent.click(within(dialog).getByRole('button', { name: 'Permissions' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: /Skip all approvals/ }));
  assert.match(within(dialog).getByText(/carries out every action/).textContent ?? '', /without pausing/);

  // "+" reveals where the task runs.
  fireEvent.click(within(dialog).getByRole('button', { name: 'More options' }));
  await within(dialog).findByRole('option', { name: 'Website' });
  fireEvent.change(within(dialog).getByLabelText('Run in'), { target: { value: '/srv/website' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

  await waitFor(() => assert.equal(harness.api.create.mock.calls.length, 1));
  const [body] = harness.api.create.mock.calls[0];
  assert.equal(body.name, 'Weekly cleanup');
  assert.equal(body.prompt, 'Tidy the logs');
  assert.equal(body.projectPath, '/srv/website');
  assert.deepEqual(body.schedule, { kind: 'weekly', time: '09:00', days: [1, 5] });
  assert.equal(body.model, 'opus-5');
  assert.equal(body.permission, 'all');
  assert.equal(body.enabled, true);
  assert.ok(typeof body.timezone === 'string' && body.timezone.length > 0);
});

test('weekdays and manual permission are saved as Monday-Friday and "manual"', async () => {
  harness.tasks = [];
  const { view } = renderPage();
  await view.findByText('No scheduled tasks yet.');
  const dialog = await openManualEditor(view);
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Standup' } });
  fireEvent.change(within(dialog).getByLabelText('Instructions'), { target: { value: 'Summarise open PRs' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Repeat' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: 'Weekdays' }));
  fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '08:30' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Permissions' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: /^Manual/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

  await waitFor(() => assert.equal(harness.api.create.mock.calls.length, 1));
  const [body] = harness.api.create.mock.calls[0];
  assert.deepEqual(body.schedule, { kind: 'weekly', time: '08:30', days: [1, 2, 3, 4, 5] });
  assert.equal(body.permission, 'manual');
  assert.equal(body.model, null);
});

test('search, filter and "Include completed" narrow the list', async () => {
  harness.tasks = [TASK, FINISHED];
  const { view } = renderPage();
  await view.findByText('Morning report');
  assert.equal(view.queryByText('Release notes'), null, 'finished one-off tasks are hidden by default');

  fireEvent.click(view.getByRole('button', { name: 'Sort' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: 'Include completed' }));
  assert.ok(await view.findByText('Release notes'));

  fireEvent.click(view.getByRole('button', { name: 'Filter' }));
  fireEvent.click(await view.findByRole('menuitemradio', { name: 'Projects' }));
  await waitFor(() => assert.equal(view.queryByText('Morning report'), null));
  assert.ok(view.getByText('Release notes'));
  fireEvent.click(view.getByRole('menuitemradio', { name: 'Chat' }));
  await view.findByText('Morning report');

  // The filter menu has an "All" for Source and another for Status; the first is Source.
  fireEvent.click(within(view.getByRole('menu', { name: 'Filter' })).getAllByRole('menuitemradio', { name: 'All' })[0]);
  fireEvent.click(view.getByRole('button', { name: 'Search scheduled tasks…' }));
  fireEvent.change(view.getByRole('searchbox', { name: 'Search scheduled tasks…' }), { target: { value: 'nothing like this' } });
  assert.ok(await view.findByText('No scheduled tasks match.'));
  fireEvent.click(view.getByRole('button', { name: 'Close search' }));
  assert.ok(await view.findByText('Morning report'));
});

test('a server refusal is shown in the editor', async () => {
  harness.tasks = [];
  harness.api.create.mockImplementation(async () => json({ success: false, error: { message: 'That time has already passed.' } }, false));
  const { view } = renderPage();
  await view.findByText('No scheduled tasks yet.');
  const dialog = await openManualEditor(view);
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x' } });
  fireEvent.change(within(dialog).getByLabelText('Instructions'), { target: { value: 'y' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
  assert.ok(await within(dialog).findByText('That time has already passed.'));
});

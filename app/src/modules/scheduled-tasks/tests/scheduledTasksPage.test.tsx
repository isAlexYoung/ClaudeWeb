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
  harness.api.models.mockImplementation(async () => json({ success: true, data: { models: [{ value: 'opus', label: 'Opus' }] } }));
});

test('lists tasks with their schedule, next run and run history', async () => {
  const onOpenSession = vi.fn();
  const view = render(<ScheduledTasksPage onOpenSession={onOpenSession} />);
  const card = (await view.findByText('Morning report')).closest('li') as HTMLElement;
  assert.match(card.textContent ?? '', /Every day at 09:00/);
  assert.match(card.textContent ?? '', /Chat \(no project\)/);
  assert.match(card.textContent ?? '', /Failed/);

  fireEvent.click(within(card).getByRole('button', { name: '1 run' }));
  assert.ok(within(card).getByText('Not allowed in an unattended run'));
  fireEvent.click(within(card).getByText('Failed', { selector: '.scheduled-task-history span' }).closest('button') as HTMLElement);
  assert.deepEqual(onOpenSession.mock.calls, [['session-9']]);
});

test('run now and pause go to the server, and a change announcement reloads the list', async () => {
  const view = render(<ScheduledTasksPage onOpenSession={() => {}} />);
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

test('the editor creates a weekly task in a project with the chosen permission', async () => {
  harness.tasks = [];
  const view = render(<ScheduledTasksPage onOpenSession={() => {}} />);
  await view.findByText('No scheduled tasks yet.');
  fireEvent.click(view.getAllByRole('button', { name: 'New task' })[0]);

  const dialog = await view.findByRole('dialog');
  await within(dialog).findByRole('option', { name: 'Website' });
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Weekly cleanup' } });
  fireEvent.change(within(dialog).getByLabelText('Run in'), { target: { value: '/srv/website' } });
  fireEvent.change(within(dialog).getByLabelText('Prompt'), { target: { value: 'Tidy the logs' } });
  fireEvent.change(within(dialog).getByLabelText('Repeat'), { target: { value: 'weekly' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Fri' }));
  fireEvent.change(within(dialog).getByLabelText('Model'), { target: { value: 'opus' } });
  fireEvent.click(within(dialog).getByRole('radio', { name: /Allow everything/ }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

  await waitFor(() => assert.equal(harness.api.create.mock.calls.length, 1));
  const [body] = harness.api.create.mock.calls[0];
  assert.equal(body.name, 'Weekly cleanup');
  assert.equal(body.projectPath, '/srv/website');
  assert.deepEqual(body.schedule, { kind: 'weekly', time: '09:00', days: [1, 5] });
  assert.equal(body.model, 'opus');
  assert.equal(body.permission, 'all');
  assert.equal(body.enabled, true);
  assert.ok(typeof body.timezone === 'string' && body.timezone.length > 0);
});

test('a server refusal is shown in the editor', async () => {
  harness.tasks = [];
  harness.api.create.mockImplementation(async () => json({ success: false, error: { message: 'That time has already passed.' } }, false));
  const view = render(<ScheduledTasksPage onOpenSession={() => {}} />);
  await view.findByText('No scheduled tasks yet.');
  fireEvent.click(view.getAllByRole('button', { name: 'New task' })[0]);
  const dialog = await view.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'x' } });
  fireEvent.change(within(dialog).getByLabelText('Prompt'), { target: { value: 'y' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  assert.ok(await within(dialog).findByText('That time has already passed.'));
});

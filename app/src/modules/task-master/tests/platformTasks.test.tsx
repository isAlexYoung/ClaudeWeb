import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import '@/modules/i18n';

const mocks = vi.hoisted(() => ({
  tasks: vi.fn(), initialize: vi.fn(), platform: true,
  auth: { user: { username: 'platform-user' }, token: null as string | null, isLoading: false },
  socket: { subscribe: vi.fn(() => () => {}) },
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/shared/utils', async (original) => ({
  ...(await original<Record<string, unknown>>()), get IS_PLATFORM() { return mocks.platform; },
}));
vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => mocks.socket }));
vi.mock('@/shared/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  api: {
    projectTaskmaster: async () => ({ ok: true, json: async () => ({ taskmaster: { hasTaskmaster: true } }) }),
    taskmaster: { tasks: mocks.tasks, mcpStatus: async () => ({ ok: true, json: async () => ({}) }), initialize: mocks.initialize },
  },
}));
const { TaskMasterProvider, useTaskMaster } = await import('@/modules/task-master/context/TaskMasterContext');
const { default: TaskMasterSetupModal } = await import('@/modules/task-master/modals/TaskMasterSetupModal');
const project = { projectId: 'p1', displayName: 'Demo', fullPath: '/home/wdguest/demo' };
function Controls() {
  const context = useTaskMaster();
  return <><button onClick={() => context.setCurrentProject(project as never)}>select</button>
    <button onClick={() => context.setCurrentProject({ ...project, projectId: 'p2' } as never)}>switch</button>
    <output>{context.tasks.map(task => task.title).join(',')}</output></>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform = true;
  mocks.tasks.mockImplementation(async () => ({ ok: true, json: async () => ({ tasks: [{ id: 1, title: 'First task', status: 'pending' }] }) }));
  mocks.initialize.mockImplementation(async () => new Response('{"output":"initialized"}'));
});
test('platform users without a ClaudeWeb token can load project tasks', async () => {
  render(<TaskMasterProvider><Controls /></TaskMasterProvider>);
  fireEvent.click(screen.getByText('select'));
  expect(await screen.findByText('First task')).toBeTruthy();
  expect(mocks.tasks).toHaveBeenCalledWith('p1');
});
test('standalone users still require a ClaudeWeb token', async () => {
  mocks.platform = false;
  render(<TaskMasterProvider><Controls /></TaskMasterProvider>);
  fireEvent.click(screen.getByText('select'));
  await act(async () => { await Promise.resolve(); });
  expect(mocks.tasks).not.toHaveBeenCalled();
});
test('a late task response cannot replace the newly selected project', async () => {
  let release: ((value: unknown) => void) | undefined;
  mocks.tasks.mockImplementation((id: string) => id === 'p1' ? new Promise(resolve => { release = resolve; })
    : Promise.resolve({ ok: true, json: async () => ({ tasks: [{ id: 2, title: 'New project task' }] }) }));
  render(<TaskMasterProvider><Controls /></TaskMasterProvider>);
  fireEvent.click(screen.getByText('select'));
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.click(screen.getByText('switch'));
  await screen.findByText('New project task');
  await act(async () => { release?.({ ok: true, json: async () => ({ tasks: [{ title: 'Old project task' }] }) }); });
  expect(screen.queryByText('Old project task')).toBeNull();
});
test('initialization uses the server API and refreshes the board on completion', async () => {
  const onClose = vi.fn(), afterClose = vi.fn();
  render(<TaskMasterSetupModal isOpen project={project as never} onClose={onClose} onAfterClose={afterClose} />);
  fireEvent.click(screen.getByRole('button', { name: 'Initialize' }));
  await screen.findByRole('status');
  await waitFor(() => expect(screen.getByRole('status').textContent).not.toContain('Initializing'));
  expect(mocks.initialize).toHaveBeenCalledWith('p1');
  fireEvent.click(screen.getByRole('button', { name: /Close.*Continue/i }));
  expect(afterClose).toHaveBeenCalledOnce();
});
test('initialization failure stays visible and can be retried', async () => {
  mocks.initialize.mockImplementationOnce(async () => new Response('{"message":"CLI unavailable"}', { status: 500 }));
  render(<TaskMasterSetupModal isOpen project={project as never} onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Initialize' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'CLI unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Initialize' }));
  await waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(2));
});

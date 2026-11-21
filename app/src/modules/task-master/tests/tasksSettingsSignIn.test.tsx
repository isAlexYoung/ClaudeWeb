import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  installationStatus: vi.fn(),
  auth: { user: null as { username: string } | null, token: null as string | null, isLoading: false },
}));
vi.mock('@/modules/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/shared/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  api: { taskmaster: { installationStatus: mocks.installationStatus } },
}));
const { TasksSettingsProvider, useTasksSettings } = await import('@/modules/task-master/context/TasksSettingsContext');

function Status() {
  const { isTaskMasterInstalled } = useTasksSettings();
  return <output>{String(isTaskMasterInstalled)}</output>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { user: null, token: null, isLoading: false };
  mocks.installationStatus.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ installation: { isInstalled: true, version: '0.43.1' }, isReady: false }),
  }));
});

// The provider sits above the login page: a check made before sign-in was
// refused and showed TaskMaster as not installed until the page was reloaded.
test('TaskMaster is checked once the user has signed in, not on the login page', async () => {
  const view = render(<TasksSettingsProvider><Status /></TasksSettingsProvider>);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(mocks.installationStatus).not.toHaveBeenCalled();
  expect(screen.getByText('null')).toBeTruthy();

  mocks.auth = { user: { username: 'ClaudeWeb' }, token: 'token', isLoading: false };
  view.rerender(<TasksSettingsProvider><Status /></TasksSettingsProvider>);
  await waitFor(() => expect(screen.getByText('true')).toBeTruthy());
  expect(mocks.installationStatus).toHaveBeenCalledTimes(1);
});

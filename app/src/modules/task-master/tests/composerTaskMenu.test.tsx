import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';


const taskMasterState = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}));
const settingsState = vi.hoisted(() => ({
  value: { tasksEnabled: true, isTaskMasterInstalled: true as boolean | null },
}));
const prdFiles = vi.hoisted(() => vi.fn());

vi.mock('@/modules/task-master/context/TaskMasterContext', () => ({
  useTaskMaster: () => taskMasterState.value,
}));
vi.mock('@/modules/task-master/context/TasksSettingsContext', () => ({
  useTasksSettings: () => settingsState.value,
}));
vi.mock('@/modules/task-master/modals/TaskMasterSetupModal', () => ({ default: () => null }));
vi.mock('@/shared/api', () => ({ api: { taskmaster: { prdFiles } } }));

import { useComposerTaskMenu } from '@/modules/task-master/hooks/useComposerTaskMenu';

beforeEach(() => {
  settingsState.value = { tasksEnabled: true, isTaskMasterInstalled: true };
  taskMasterState.value = {
    currentProject: { projectId: 'p1', taskmaster: { hasTaskmaster: true } },
    projectTaskMaster: null,
    tasks: [{ id: 7, title: 'Ship it', status: 'pending' }],
    nextTask: { id: 7, title: 'Ship it', status: 'pending' },
    setCurrentProject: vi.fn(),
    refreshTasks: vi.fn(),
  };
  prdFiles.mockReset();
});

test('no menu while tasks are off or no project is open', () => {
  settingsState.value = { tasksEnabled: false, isTaskMasterInstalled: true };
  assert.equal(renderHook(() => useComposerTaskMenu({ onInsertPrompt: () => {} })).result.current.menu, null);
  settingsState.value = { tasksEnabled: true, isTaskMasterInstalled: true };
  taskMasterState.value = { ...taskMasterState.value, currentProject: null };
  assert.equal(renderHook(() => useComposerTaskMenu({ onInsertPrompt: () => {} })).result.current.menu, null);
});

test('the next-task and PRD prompts name the task and the PRD file', async () => {
  const insert = vi.fn();
  prdFiles.mockResolvedValue({ ok: true, json: async () => ({ prdFiles: [{ name: 'app.md' }] }) });
  const { result } = renderHook(() => useComposerTaskMenu({ onInsertPrompt: insert }));
  const menu = result.current.menu!;
  assert.equal(menu.isReady, true);
  assert.deepEqual(menu.nextTask, { id: '7', title: 'Ship it' });

  menu.onStartNextTask();
  assert.match(insert.mock.calls[0][0], /task-master show 7/);
  assert.match(insert.mock.calls[0][0], /Ship it/);

  assert.equal(menu.prdFiles, null);
  act(() => menu.onLoadPrdFiles());
  await waitFor(() => assert.deepEqual(result.current.menu!.prdFiles, ['app.md']));
  assert.equal(prdFiles.mock.calls[0][0], 'p1');
  result.current.menu!.onGenerateFromPrd('app.md');
  assert.match(insert.mock.calls[1][0], /task-master parse-prd \.taskmaster\/docs\/app\.md/);
});

test('a project without TaskMaster is not ready', () => {
  taskMasterState.value = {
    ...taskMasterState.value,
    currentProject: { projectId: 'p2', taskmaster: { hasTaskmaster: false } },
    tasks: [],
    nextTask: null,
  };
  const { result } = renderHook(() => useComposerTaskMenu({ onInsertPrompt: () => {} }));
  assert.equal(result.current.menu!.isReady, false);
});

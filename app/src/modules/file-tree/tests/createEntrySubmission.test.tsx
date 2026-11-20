import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { useFileTreeOperations } from '@/modules/file-tree/hooks/useFileTreeOperations';
import type { Project } from '@/shared/types';

const harness = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { createFile: harness.create } }));
const project = { projectId: 'p1', path: '/work/project', fullPath: '/work/project', displayName: 'Project' } as Project;
beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });
beforeEach(() => { harness.create.mockReset(); });

test('Enter, blur, and an old delayed blur submit a draft only once', async () => {
  let finish!: (value: unknown) => void;
  harness.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const toast = vi.fn();
  const view = renderHook(() => useFileTreeOperations({ selectedProject: project, onRefresh: vi.fn(), showToast: toast }));
  act(() => view.result.current.handleStartCreate('/work/project/test', 'file'));
  const submit = view.result.current.handleConfirmCreate;
  let first!: Promise<void>;
  act(() => { first = submit(); void submit(); });
  assert.equal(harness.create.mock.calls.length, 1);
  assert.deepEqual(harness.create.mock.calls[0], ['p1', { path: '/work/project/test', type: 'file', name: 'untitled.txt' }]);
  await act(async () => { finish({ ok: true }); await first; });
  await act(async () => { await submit(); });
  assert.equal(harness.create.mock.calls.length, 1);
  assert.deepEqual(toast.mock.calls, [['文件创建成功', 'success']]);
  assert.equal(view.result.current.isCreating, false);
});

test('a genuine name conflict stays editable and is reported in the selected language', async () => {
  harness.create.mockResolvedValue({ ok: false, json: async () => ({ error: 'File already exists', code: 'FILE_TREE_ENTRY_EXISTS' }) });
  const toast = vi.fn();
  const view = renderHook(() => useFileTreeOperations({ selectedProject: project, onRefresh: vi.fn(), showToast: toast }));
  act(() => view.result.current.handleStartCreate('/work/project/test', 'file'));
  await act(async () => { await view.result.current.handleConfirmCreate(); });
  assert.equal(view.result.current.isCreating, true);
  assert.deepEqual(toast.mock.calls[0], ['当前文件夹中已存在同名文件或文件夹', 'error']);
  act(() => view.result.current.setNewItemName('test.md'));
  harness.create.mockResolvedValue({ ok: true });
  await act(async () => { await view.result.current.handleConfirmCreate(); });
  assert.equal(harness.create.mock.calls[1][1].name, 'test.md');
  assert.equal(view.result.current.isCreating, false);
});

import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import FileTree from '@/modules/file-tree/FileTree';
import type { Project } from '@/shared/types';

const harness = vi.hoisted(() => ({ browse: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: { browseProjectFiles: harness.browse } }));
beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });

test('the file panel browses parents and sibling folders without changing the conversation project', async () => {
  const project: Project = { projectId: 'p1', displayName: 'Project', path: '/home/user/project', fullPath: '/home/user/project' };
  harness.browse.mockImplementation(async (_id: string, requested?: string) => {
    const path = requested || project.path;
    return { ok: true, json: async () => ({ path, projectPath: project.path, parentPath: path === '/home/user' ? null : '/home/user',
      readOnly: false, files: path === '/home/user'
        ? [{ name: 'neighbor', path: '/home/user/neighbor', type: 'directory', children: [] }]
        : [{ name: path === project.path ? 'CLAUDE.md' : 'sibling.txt', path: `${path}/file.txt`, type: 'file' }],
    }) };
  });
  const view = render(<FileTree selectedProject={project} />);
  await view.findByText('CLAUDE.md');
  assert.ok(view.getByRole('button', { name: '上传文件（每个文件最大 200MB）' }));
  assert.ok(view.getByRole('button', { name: '折叠全部已展开文件夹' }));
  fireEvent.click(view.getByRole('button', { name: '返回上一级文件夹' }));
  await view.findByText('neighbor');
  assert.equal((view.getByRole('button', { name: '返回上一级文件夹' }) as HTMLButtonElement).disabled, true);
  assert.ok(view.getByRole('button', { name: '新建文件 (Cmd+N)' }));
  fireEvent.click(view.getByText('neighbor'));
  await view.findByText('sibling.txt');
  fireEvent.click(view.getByRole('button', { name: '返回项目目录' }));
  await view.findByText('CLAUDE.md');
  await waitFor(() => assert.equal(view.queryByRole('button', { name: '返回项目目录' }), null));
  assert.equal(project.path, '/home/user/project');
  assert.ok(harness.browse.mock.calls.every((args: unknown[]) => args[0] === 'p1'));
});

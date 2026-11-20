import assert from 'node:assert/strict';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { SideChatInspector } from '@/modules/side-chat/SideChatInspector';
import type { SideChat } from '@/shared/types';

beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });
const makeChat = (id: string, text: string): SideChat => ({
  id, parentSessionId: 'inspector-main', projectId: 'p1', model: 'opus', effort: 'high', createdAt: new Date().toISOString(), minimized: true,
  source: { id: `q-${id}`, messageKey: `m-${id}`, text, role: 'assistant', kind: 'text', startOffset: 0, timestamp: '2026-11-18' },
  position: { x: 100, y: 100, width: 400, height: 300 }, draft: '', status: 'idle', messages: [{ id: `u-${id}`, role: 'user', content: `my question ${id}` }],
});

test('inspector starts collapsed, previews user questions, jumps without opening, confirms deletion and renumbers', async () => {
  let chats = [makeChat('one', 'first origin'), makeChat('two', 'second origin')];
  const updates: unknown[] = [];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'DELETE') chats = chats.filter(c => !String(url).includes(c.id));
    if (init?.method === 'PATCH') updates.push(init.body);
    return new Response(JSON.stringify(init?.method === 'DELETE' ? { deleted: true } : chats), { status: 200 });
  });
  const jump = vi.fn(); window.addEventListener('claudeweb:sidechat-jump', jump);
  const view = render(<SideChatInspector sessionId="inspector-main" />);
  assert.equal(view.getByRole('button', { name: '侧边聊天' }).getAttribute('aria-expanded'), 'false');
  assert.equal(view.queryByText('first origin'), null);
  fireEvent.click(view.getByRole('button', { name: '侧边聊天' }));
  await view.findByText('first origin');
  fireEvent.pointerEnter(view.getByText('first origin').closest('.side-chat-history-row')!);
  assert.ok(view.getByRole('tooltip').textContent?.includes('my question one'));
  fireEvent.click(view.getByRole('button', { name: '跳转至该位置 1' }));
  assert.equal(jump.mock.calls[0][0].detail.id, 'one'); assert.equal(updates.length, 0);
  fireEvent.click(view.getByRole('button', { name: '更多操作 1' }));
  assert.equal(view.getAllByRole('menuitem').length, 3);
  assert.ok(view.getByRole('menuitem', { name: '复制原文引用' }));
  fireEvent.click(view.getByRole('button', { name: '删除侧边聊天 1' }));
  assert.ok(view.getByRole('alertdialog')); assert.equal(chats.length, 2);
  fireEvent.click(view.getByRole('button', { name: '否' })); assert.equal(chats.length, 2);
  fireEvent.click(view.getByRole('button', { name: '删除侧边聊天 1' })); fireEvent.click(view.getByRole('button', { name: '是' }));
  await waitFor(() => assert.equal(chats.length, 1));
  assert.ok(view.getByText('second origin')); assert.ok(view.getByRole('button', { name: '跳转至该位置 1' }));
  assert.equal(view.queryByRole('button', { name: '跳转至该位置 2' }), null);
  view.rerender(<SideChatInspector sessionId="other-parent" />);
  assert.equal(view.getByRole('button', { name: '侧边聊天' }).getAttribute('aria-expanded'), 'false');
  window.removeEventListener('claudeweb:sidechat-jump', jump); view.unmount(); fetcher.mockRestore();
});

import { beforeAll, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { i18n } from '@/modules/i18n';
import { ProjectMemoryEditor } from '@/modules/project-memory/ProjectMemoryEditor';
import { ProjectMemoryInspector } from '@/modules/project-memory/ProjectMemoryInspector';
import type { ProjectMemorySnapshot, TextQuote } from '@/shared/types';

beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });
const source: TextQuote = { id: 'q1', text: 'selected original', messageKey: 'm1', role: 'assistant', kind: 'text', timestamp: '2026-11-19T01:00:00Z', startOffset: 4 };
const snapshot = (text = 'project instruction', version = 'v1'): ProjectMemorySnapshot => ({ projectId: 'p1', path: '/test/CLAUDE.md', version, entries: [{ id: 'e1', text, createdAt: '2026-11-19T01:00:00Z', updatedAt: '2026-11-19T01:00:00Z', source, sourceSessionId: 's1' }] });

test('the anchored editor prefills exact selection, submits the edited instruction and snapshot version, then closes', async () => {
  const writes: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('/api/project-memory/')) return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    if (init?.method === 'POST') writes.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  });
  const close = vi.fn(), saved = vi.fn();
  render(<ProjectMemoryEditor projectId="p1" projectName="test" sessionId="s1" source={source} anchor={{ x: 9999, y: 9999 }} onClose={close} onSaved={saved} />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(source.text);
  expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('false');
  await waitFor(() => expect((screen.getByRole('button', { name: '写入记忆' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Use Chinese UI for this project' } });
  fireEvent.click(screen.getByRole('button', { name: '写入记忆' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(writes).toEqual([{ text: 'Use Chinese UI for this project', source, sessionId: 's1', version: 'v1' }]);
  expect(close).toHaveBeenCalledTimes(1);
});

test('file conflicts preserve edits, require explicit reload, and use the reviewed new version on retry', async () => {
  let version = 'v1'; const writes: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('/api/project-memory/')) return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)); writes.push(body);
      if (body.version === 'v1') { version = 'v2'; return new Response(JSON.stringify({ error: { code: 'MEMORY_VERSION_CONFLICT' } }), { status: 409 }); }
    }
    return new Response(JSON.stringify(snapshot(version === 'v1' ? 'old rule' : 'external editor rule', version)), { status: 200 });
  });
  const close = vi.fn();
  render(<ProjectMemoryEditor projectId="p1" projectName="test" sessionId="s1" entry={snapshot('old rule').entries[0]} anchor={{ x: 20, y: 20 }} onClose={close} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '写入记忆' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my own revised rule' } });
  fireEvent.click(screen.getByRole('button', { name: '写入记忆' }));
  await screen.findByRole('alert'); expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my own revised rule');
  fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
  await screen.findByText('external editor rule');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my own revised rule');
  fireEvent.click(screen.getByRole('button', { name: '写入记忆' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(writes.map(body => body.version)).toEqual(['v1', 'v2']);
});

test('inspector is collapsed, lists project memories, jumps to source, confirms deletion and resets project scope', async () => {
  let data = snapshot(); const writes: string[] = [];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('/api/project-memory/')) return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    if (init?.method === 'DELETE') { writes.push(String(init.body)); data = { ...data, entries: [], version: 'v2' }; }
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const jump = vi.fn(); window.addEventListener('claudeweb:quote-jump', jump);
  try {
    const view = render(<MemoryRouter><ProjectMemoryInspector projectId="p1" projectName="test" sessionId="s1" onFileOpen={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '记忆' }).getAttribute('aria-expanded')).toBe('false');
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '记忆' }));
    await screen.findByText('project instruction');
    fireEvent.click(screen.getByRole('button', { name: '跳转至原消息' }));
    expect(jump.mock.calls[0][0].detail).toEqual({ parentSessionId: 's1', source });
    fireEvent.click(screen.getByRole('button', { name: '删除记忆 1' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy(); expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '删除记忆' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(JSON.parse(writes[0])).toEqual({ version: 'v1' });
    await screen.findByText(/暂无项目记忆/);
    view.rerender(<MemoryRouter><ProjectMemoryInspector projectId="p2" projectName="another" sessionId="s2" onFileOpen={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('button', { name: '记忆' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('project instruction')).toBeNull();
  } finally { window.removeEventListener('claudeweb:quote-jump', jump); }
});

test('opening an old inspector row never silently adopts the newer file version returned by its initial fetch', async () => {
  const writes: Record<string, unknown>[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (!String(url).includes('/api/project-memory/')) return new Response(JSON.stringify({ preferences: {} }), { status: 200 });
    if (init?.method === 'PATCH') { writes.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ error: { code: 'MEMORY_VERSION_CONFLICT' } }), { status: 409 }); }
    return new Response(JSON.stringify(snapshot('new external rule', 'v2')), { status: 200 });
  });
  render(<ProjectMemoryEditor projectId="p1" projectName="test" sessionId="s1" entry={snapshot('old sidebar rule').entries[0]} initialVersion="v1" anchor={{ x: 20, y: 20 }} onClose={() => {}} />);
  await waitFor(() => expect((screen.getByRole('button', { name: '写入记忆' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my changed rule' } });
  fireEvent.click(screen.getByRole('button', { name: '写入记忆' }));
  await screen.findByRole('alert');
  expect(writes[0].version).toBe('v1');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my changed rule');
});

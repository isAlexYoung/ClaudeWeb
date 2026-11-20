import assert from 'node:assert/strict';

import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { SideChatWindow } from '@/modules/side-chat/SideChatWindow';
import type { SideChat } from '@/shared/types';

beforeAll(async () => { await i18n.changeLanguage('zh-CN'); });
const chat: SideChat = {
  id: 'floating-unit-test', parentSessionId: 'main', projectId: 'p1', model: 'opus', effort: 'high', createdAt: '2026-11-18',
  source: { id: 'quote', text: 'selected source', messageKey: 'key', role: 'assistant', kind: 'text', startOffset: 0, timestamp: '2026-11-18' },
  minimized: false, position: { x: 600, y: 500, width: 440, height: 460 }, draft: '', status: 'idle', messages: [],
};

test('a floating chat stays inside the visible viewport when the mobile keyboard reduces its height', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  try {
    const view = render(<SideChatWindow chat={chat} modelLabel="Opus 5.5" number={1} active onUpdate={async () => {}} onSend={async () => {}} onStop={async () => {}} onDelete={async () => {}} />);
    const panel = view.getByRole('dialog');
    assert.ok(parseFloat(panel.style.left) + parseFloat(panel.style.width) <= 390);
    act(() => { viewport.height = 360; viewport.dispatchEvent(new Event('resize')); });
    assert.ok(parseFloat(panel.style.top) + parseFloat(panel.style.height) <= 360);
    assert.ok(parseFloat(panel.style.height) >= 160);
  } finally {
    if (descriptor) Object.defineProperty(window, 'visualViewport', descriptor); else Reflect.deleteProperty(window, 'visualViewport');
  }
});

test('failed sends retain the question, X requires confirmation, and the panel has no modal backdrop', async () => {
  const remove = vi.fn(async () => {}), send = vi.fn(async () => { throw new Error('offline'); });
  const view = render(<SideChatWindow chat={chat} modelLabel="Opus 5.5" number={1} active onUpdate={async () => {}} onSend={send} onStop={async () => {}} onDelete={remove} />);
  assert.equal(view.getByRole('dialog').getAttribute('aria-modal'), 'false');
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'keep my question' } });
  fireEvent.click(view.getByRole('button', { name: '发送' }));
  await view.findByRole('alert'); assert.equal((view.getByRole('textbox') as HTMLTextAreaElement).value, 'keep my question');
  assert.equal(send.mock.calls.length, 1);
  fireEvent.click(view.getByRole('button', { name: '删除侧边聊天' }));
  assert.equal(remove.mock.calls.length, 0);
  fireEvent.click(view.getByRole('button', { name: '是' }));
  await waitFor(() => assert.equal(remove.mock.calls.length, 1));
});

test('the composer grows with its draft, shrinks after clearing, and remeasures a restored panel', () => {
  const view = render(<SideChatWindow chat={{ ...chat, id: 'growing-composer', draft: '' }} modelLabel="Opus 5.5" number={1} active onUpdate={async () => {}} onSend={async () => {}} onStop={async () => {}} onDelete={async () => {}} />);
  const input = view.getByRole('textbox') as HTMLTextAreaElement;
  Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => input.value.includes('\n') ? 96 : 24 });
  fireEvent.change(input, { target: { value: 'one\ntwo\nthree' } });
  assert.equal(input.style.height, '96px');
  fireEvent.change(input, { target: { value: '' } });
  assert.equal(input.style.height, '38px');
  view.rerender(<SideChatWindow chat={{ ...chat, id: 'growing-composer' }} modelLabel="Opus 5.5" number={1} active={false} onUpdate={async () => {}} onSend={async () => {}} onStop={async () => {}} onDelete={async () => {}} />);
  fireEvent.change(input, { target: { value: 'restored\ntext' } });
  view.rerender(<SideChatWindow chat={{ ...chat, id: 'growing-composer' }} modelLabel="Opus 5.5" number={1} active onUpdate={async () => {}} onSend={async () => {}} onStop={async () => {}} onDelete={async () => {}} />);
  assert.equal(input.style.height, '96px');
});

test.each([['first', 'second'], ['first', 'second', 'first']])('late autosave responses preserve newer side-chat typing: %j', async (...values) => {
  vi.useFakeTimers();
  const releases: Array<() => void> = [];
  const onUpdate = () => new Promise<void>(resolve => releases.push(resolve));
  const props = { modelLabel: 'Opus', number: 1, active: true, onUpdate, onSend: async () => {}, onStop: async () => {}, onDelete: async () => {} };
  const id = `draft-order-${values.length}`;
  const view = render(<SideChatWindow {...props} chat={{ ...chat, id, draft: 'seed' }} />);
  const input = view.getByRole('textbox') as HTMLTextAreaElement;
  try {
    for (const value of values) {
      fireEvent.change(input, { target: { value } });
      await act(async () => vi.advanceTimersByTimeAsync(450));
    }
    input.focus(); input.setSelectionRange(2, 2);
    assert.equal(releases.length, values.length);
    for (let i = 0; i < releases.length; i++) {
      await act(async () => releases[i]());
      view.rerender(<SideChatWindow {...props} chat={{ ...chat, id, draft: values[i] }} />);
      assert.equal(input.value, values.at(-1), 'an older saved snapshot must not replace the latest local draft');
      assert.equal(input.selectionStart, 2);
    }
  } finally {
    view.unmount(); localStorage.removeItem(`side-chat-draft:${id}`); vi.useRealTimers();
  }
});

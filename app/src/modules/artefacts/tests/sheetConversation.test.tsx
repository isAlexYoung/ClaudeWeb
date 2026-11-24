import assert from 'node:assert/strict';

import { fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ArtefactSummary } from '@/shared/types';
import SheetConversation from '@/modules/artefacts/sheet/SheetConversation';
import { notifyArtefactsChanged, useArtefactSessionIds } from '@/modules/artefacts/useArtefacts';

const harness = vi.hoisted(() => ({
  artefacts: [] as ArtefactSummary[],
  messages: [] as unknown[],
}));

vi.mock('@/shared/api', () => ({
  api: {
    artefacts: {
      list: vi.fn(async () => new Response(JSON.stringify({ success: true, data: harness.artefacts }), { status: 200 })),
    },
    providers: {
      sessionMessages: vi.fn(async () => new Response(JSON.stringify({ data: { messages: harness.messages } }), { status: 200 })),
    },
  },
  readApiErrorMessage: () => null,
}));

beforeAll(async () => {
  await i18n.changeLanguage('zh-CN');
});

beforeEach(() => {
  harness.artefacts = [];
  harness.messages = [];
});

test('empty SheetConversation shows the heading and clickable suggestion pills without a close X or old empty text', async () => {
  const onSelectSuggestion = vi.fn();
  const onOpenInChat = vi.fn();
  const view = render(
    <SheetConversation
      sessionId="session-1"
      running={false}
      onSelectSuggestion={onSelectSuggestion}
      onOpenInChat={onOpenInChat}
    />,
  );

  await view.findByRole('heading', { name: '您需要什么样的电子表格？' });
  assert.equal(view.queryByRole('button', { name: '隐藏对话' }), null);
  assert.equal(view.queryByText(/还没有对话/), null);
  assert.equal(view.queryByRole('button', { name: '在聊天中打开' }), null);

  fireEvent.click(view.getByRole('button', { name: '包含总计和图表的月度预算' }));
  assert.deepEqual(onSelectSuggestion.mock.calls, [['包含总计和图表的月度预算']]);
});

test('SheetConversation displays the last run error alert when a run fails', async () => {
  const view = render(
    <SheetConversation
      sessionId="session-1"
      running={false}
      error="No conversation found with session ID: abc"
      onSelectSuggestion={vi.fn()}
      onOpenInChat={vi.fn()}
    />,
  );

  const alert = await view.findByRole('alert');
  assert.match(alert.textContent ?? '', /No conversation found with session ID: abc/);
});

test('notifyArtefactsChanged with an upsert updates sidebar artefact session ids immediately', async () => {
  const { result } = renderHook(() => useArtefactSessionIds());
  await waitFor(() => assert.equal(result.current.size, 0));

  const created: ArtefactSummary = {
    id: 'sheet-new',
    kind: 'sheet',
    title: '未命名',
    sessionId: 'session-new',
    pinned: false,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    openedAt: '2026-11-24T00:00:00.000Z',
  };
  harness.artefacts = [created];
  notifyArtefactsChanged({ upsert: created });

  await waitFor(() => assert.equal(result.current.has('session-new'), true));
});

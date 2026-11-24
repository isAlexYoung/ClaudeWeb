import assert from 'node:assert/strict';

import { forwardRef } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import type { ArtefactDetail } from '@/shared/types';
import SpreadsheetEditor from '@/modules/artefacts/sheet/SpreadsheetEditor';

const harness = vi.hoisted(() => ({
  allowEditValues: [] as Array<boolean | undefined>,
  detail: null as ArtefactDetail | null,
}));

vi.mock('@fortune-sheet/react', () => ({
  Workbook: forwardRef(({ allowEdit }: { allowEdit?: boolean }, _ref) => {
    harness.allowEditValues.push(allowEdit);
    return (
      <div className="fortune-sheet-container">
        <div className="luckysheet-scrollbar-y" data-testid="sheet-scroll-y" />
        <div className="luckysheet-scrollbar-x" data-testid="sheet-scroll-x" />
      </div>
    );
  }),
}));

vi.mock('@/shared/api', () => ({
  api: {
    artefacts: {
      open: vi.fn(async () => new Response(JSON.stringify({ success: true, data: harness.detail }), { status: 200 })),
      state: vi.fn(async () => new Response(JSON.stringify({
        success: true,
        data: {
          revision: harness.detail?.revision ?? 'rev-1',
          running: false,
          sessionId: harness.detail?.sessionId ?? 'session-1',
          lastError: null,
        },
      }), { status: 200 })),
      save: vi.fn(async () => new Response(JSON.stringify({ success: true, data: { revision: 'rev-2' } }), { status: 200 })),
      sendMessage: vi.fn(async () => new Response(JSON.stringify({ success: true, data: { sessionId: 'session-1' } }), { status: 200 })),
      update: vi.fn(async () => new Response(JSON.stringify({ success: true, data: harness.detail }), { status: 200 })),
      remove: vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
    },
  },
  readApiErrorMessage: () => null,
}));

function makeScrollable(element: HTMLElement, scrollHeight: number, clientHeight: number, scrollWidth: number, clientWidth: number) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollWidth: { configurable: true, value: scrollWidth },
    clientWidth: { configurable: true, value: clientWidth },
  });
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  harness.allowEditValues = [];
  harness.detail = {
    id: 'sheet-1',
    kind: 'sheet',
    title: 'Sine Table',
    sessionId: 'session-1',
    pinned: false,
    revision: 'rev-1',
    contentError: null,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
    openedAt: '2026-11-24T00:00:00.000Z',
    content: {
      format: 'claudeweb-sheet@1',
      sheets: [{ name: 'Sheet1', cells: { A1: 'x' } }],
    },
  };
});

test('wheel scrolling drives FortuneSheet scrollbars even while Claude is running, with allowEdit toggled instead of an overlay', async () => {
  const onSendChatMessage = vi.fn(async () => true);
  const onToggleChat = vi.fn();
  const onClose = vi.fn();
  const onSessionResolved = vi.fn();
  let fillComposer: ((prompt: string) => void) | null = null;

  const view = render(
    <SpreadsheetEditor
      artefactId="sheet-1"
      embeddedSplit
      chatOpen
      externalRunning
      onToggleChat={onToggleChat}
      onSendChatMessage={onSendChatMessage}
      registerFillComposer={(fn) => { fillComposer = fn; }}
      onSessionResolved={onSessionResolved}
      onClose={onClose}
      onOpenSession={vi.fn()}
    />,
  );

  const scrollY = await view.findByTestId('sheet-scroll-y');
  const scrollX = view.getByTestId('sheet-scroll-x');
  makeScrollable(scrollY, 2000, 400, 20, 20);
  makeScrollable(scrollX, 20, 20, 1800, 600);

  // Embedded split mode omits the legacy side conversation pane and uses native allowEdit=false with no blocking lock overlay.
  assert.equal(view.container.querySelector('.sheet-conversation'), null);
  assert.equal(view.container.querySelector('.sheet-editor-lock'), null);
  assert.equal(harness.allowEditValues[harness.allowEditValues.length - 1], false);
  assert.deepEqual(onSessionResolved.mock.calls, [['session-1']]);

  // Vertical wheel & Shift+wheel horizontal scrolling work even while Claude is running.
  const grid = view.container.querySelector('.fortune-sheet-container') as HTMLElement;
  fireEvent.wheel(grid, { deltaY: 120 });
  assert.equal(scrollY.scrollTop, 120);

  fireEvent.wheel(grid, { deltaY: 80, shiftKey: true });
  assert.equal(scrollX.scrollLeft, 80);

  // Header controls delegate to split callbacks.
  fireEvent.click(view.getByRole('button', { name: 'Hide conversation' }));
  assert.equal(onToggleChat.mock.calls.length, 1);

  // Once Claude finishes, allowEdit returns to true, suggestion fill populates input, and submit routes through ChatInterface.
  view.rerender(
    <SpreadsheetEditor
      artefactId="sheet-1"
      embeddedSplit
      chatOpen
      externalRunning={false}
      onToggleChat={onToggleChat}
      onSendChatMessage={onSendChatMessage}
      registerFillComposer={(fn) => { fillComposer = fn; }}
      onSessionResolved={onSessionResolved}
      onClose={onClose}
      onOpenSession={vi.fn()}
    />,
  );
  assert.equal(harness.allowEditValues[harness.allowEditValues.length - 1], true);

  assert.notEqual(fillComposer, null);
  fillComposer!('Plot sin(x) chart');
  const input = await waitFor(() => {
    const field = view.container.querySelector<HTMLInputElement>('.sheet-composer input');
    assert.ok(field);
    assert.equal(field.value, 'Plot sin(x) chart');
    return field;
  });

  fireEvent.submit(input.closest('form')!);
  await waitFor(() => {
    assert.deepEqual(onSendChatMessage.mock.calls, [['Plot sin(x) chart']]);
  });
});

import assert from 'node:assert/strict';

import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { test } from 'vitest';

import ChatMessagesPane from '@/modules/chat/transcript/ChatMessagesPane';
import LoadAllMessagesOverlay from '@/modules/chat/transcript/LoadAllMessagesOverlay';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { ChatMessage } from '@/shared/types';

/**
 * Scrolling up prepends older history to the first turn on screen. That turn
 * must stay the same DOM: when its key followed its first message, every page
 * remounted it, collapsing a response the user had opened, turning its rows
 * back into estimated placeholders and dropping the scroll anchor.
 */

const at = (second: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString();
const user = (second: number, content: string): ChatMessage => ({ id: `u${second}`, type: 'user', content, timestamp: at(second) });
const tool = (second: number): ChatMessage => ({
  id: `t${second}`,
  type: 'assistant',
  content: '',
  timestamp: at(second),
  isToolUse: true,
  toolName: 'Bash',
  toolInput: JSON.stringify({ command: `echo ${second}` }),
});
const answer = (second: number, content: string): ChatMessage => ({ id: `a${second}`, type: 'assistant', content, timestamp: at(second) });

// A long turn (question 1 with many tool calls) followed by a short one.
const fullHistory: ChatMessage[] = [
  user(1, 'Question one'),
  ...Array.from({ length: 12 }, (_, index) => tool(2 + index)),
  answer(20, 'Answer one'),
  user(21, 'Question two'),
  answer(22, 'Answer two'),
];

const noop = () => undefined;
const stable = {
  scrollContainerRef: createRef<HTMLDivElement>(),
  textareaRef: createRef<HTMLTextAreaElement>(),
  selectedSession: { id: 'session-1' },
  selectedProject: { projectId: 'project-1', name: 'repo', path: '/repo' },
  providerModels: {},
  providerModelCatalog: {},
  providerModelActions: {},
  createDiff: () => [],
  onGrantToolPermission: () => ({ success: true }),
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const pane = (chatMessages: ChatMessage[], hasMoreMessages: boolean) => (
  <UiPreferencesProvider>
    <ChatMessagesPane
      {...({
        ...stable,
        onWheel: noop,
        onTouchMove: noop,
        isLoadingSessionMessages: false,
        chatMessages,
        currentSessionId: 'session-1',
        provider: 'claude',
        setProvider: noop,
        setProviderModel: noop,
        providerModelsLoading: false,
        tasksEnabled: false,
        isTaskMasterInstalled: false,
        onShowAllTasks: null,
        setInput: noop,
        isLoadingMoreMessages: false,
        hasMoreMessages,
        totalMessages: fullHistory.length,
        sessionMessagesCount: chatMessages.length,
        visibleMessageCount: 1000,
        visibleMessages: chatMessages,
        loadEarlierMessages: noop,
        revealMessage: noop,
        sendMessage: noop,
        loadAllMessages: noop,
        allMessagesLoaded: !hasMoreMessages,
        isLoadingAllMessages: false,
        loadAllJustFinished: false,
        showLoadAllOverlay: false,
        showRawParameters: false,
        showThinking: false,
      } as any)}
    />
  </UiPreferencesProvider>
);
/* eslint-enable @typescript-eslint/no-explicit-any */

const sectionWith = (container: HTMLElement, text: string) => [...container.querySelectorAll('section.workspace-response-turn')]
  .find((section) => section.textContent?.includes(text));

test('loading older history keeps the first turn mounted and its opened response open', () => {
  // Only the tail is loaded: the long turn starts part-way through its tool calls.
  const tail = fullHistory.slice(8);
  const { container, rerender } = render(pane(tail, true));

  const section = sectionWith(container, 'Answer one');
  assert.ok(section, 'the partly loaded turn is on screen');
  const details = section.querySelector('details.workspace-response-process') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));

  // The older page arrives: the same turn gains its question and earlier calls.
  rerender(pane(fullHistory, false));

  const after = sectionWith(container, 'Answer one');
  // Compared as a boolean: a failing assert.equal tries to print a diff of two DOM trees.
  assert.ok(after === section, 'the turn is the same element, not a remount');
  if (!after) return;
  assert.ok(after.textContent?.includes('Question one'), 'the prepended question joined the turn');
  const process = after.querySelector<HTMLDetailsElement>('details.workspace-response-process');
  assert.equal(process?.open, true, 'the opened response stays open');
});

test('the load-all prompt keeps its place in the layout while hidden, so showing it moves nothing', () => {
  const props = { isLoadingAllMessages: false, loadAllJustFinished: false, totalMessages: 10, onLoadAllMessages: noop };
  const { container, rerender } = render(<LoadAllMessagesOverlay {...props} showLoadAllOverlay={false} />);
  const holder = container.firstElementChild as HTMLElement;
  assert.ok(holder?.classList.contains('h-0'), 'a zero-height holder is always rendered');
  assert.equal(holder.querySelector('button'), null);

  rerender(<LoadAllMessagesOverlay {...props} showLoadAllOverlay />);
  assert.ok(container.firstElementChild === holder, 'the same holder');
  assert.ok(holder.querySelector('button'), 'the prompt is drawn inside it');
});

import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import { clearQueuedMessage, readQueuedMessage } from '@/shared/chatDrafts';
import type * as ChatDrafts from '@/shared/chatDrafts';
import type { PermissionMode, Project, ProjectSession, SessionActivityMap } from '@/shared/types';

/**
 * A session whose turn has ended with background work still running keeps
 * its composer usable — but a new turn replaces the CLI process that work
 * runs under, so the work would be stopped. A message sent then is queued
 * behind the work without asking (the server holds it while the work runs);
 * the queued card's "interrupt and send" sends it now.
 */

const { appendQueuedMessage } = vi.hoisted(() => ({ appendQueuedMessage: vi.fn() }));

vi.mock('@/shared/chatDrafts', async (importOriginal) => {
  const actual = await importOriginal<typeof ChatDrafts>();
  return {
    ...actual,
    appendQueuedMessage: (...args: Parameters<typeof actual.appendQueuedMessage>) => {
      appendQueuedMessage(...args);
      return actual.appendQueuedMessage(...args);
    },
  };
});

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const UPLOADED = { name: 'notes.txt', path: '/uploads/notes.txt', mimeType: 'text/plain', size: 5 };

const backgroundOnly: SessionActivityMap = new Map([[
  'session-1',
  {
    statusText: null,
    canInterrupt: false,
    startedAt: 1,
    background: true,
    tasks: [
      { taskId: 'w1', toolUseId: 'toolu_wf', taskType: 'local_workflow', description: 'Audit the frontend', workflowName: 'frontend-architecture-audit', startedAt: 1 },
      { taskId: 'b1', toolUseId: 'toolu_inner', taskType: 'local_bash', description: 'Sleep for 60 seconds', startedAt: 2, nested: true },
      { taskId: 'a1', toolUseId: 'toolu_agent', taskType: 'local_agent', description: 'Survey the repo', startedAt: 3 },
    ],
  },
]]);

const uploads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/api/assets/uploads'));

const render = (processingSessions: SessionActivityMap) => {
  const sent: Array<{ type: string }> = [];
  const view = renderHook(() =>
    useChatComposerState({
      selectedProject: PROJECT,
      selectedSession: SESSION,
      currentSessionId: SESSION.id,
      provider: 'claude',
      permissionMode: 'default',
      cyclePermissionMode: () => undefined,
      resolvePermissionModeForProvider: () => 'default' as PermissionMode,
      currentProviderModel: 'test-model',
      currentProviderEffort: 'medium',
      isLoading: false,
      processingSessions,
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as { type: string }); },
      scrollToBottom: () => undefined,
      addMessage: () => undefined,
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  const sends = () => sent.filter((message) => message.type === 'chat.send');
  return { view, sends };
};

type View = ReturnType<typeof render>['view'];

const submit = async (view: View) => {
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/api/assets/uploads')) {
      return new Response(JSON.stringify({ uploadId: 'upload-1', chunkSize: 8 * 1024 * 1024 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/complete')) {
      return new Response(JSON.stringify({ attachment: UPLOADED }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/api/assets/uploads/')) {
      return new Response(JSON.stringify({ received: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/api/user/drafts/queued-message') && init?.method === 'POST') {
      // Nothing else is queued: the server queues the message on its own.
      const { queuedMessage } = JSON.parse(String(init.body)) as { queuedMessage: unknown };
      return new Response(JSON.stringify({ success: true, queuedMessage, appended: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  // The drafts store is module state; a message queued by one test must not
  // be restored into the next one's composer.
  clearQueuedMessage(SESSION.id);
  appendQueuedMessage.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('sending on a session with background work queues the message with its uploaded files, sends nothing, and clears the composer', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => {
    view.result.current.setInput('hello');
    view.result.current.setAttachedFiles([new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
  });

  await submit(view);

  assert.equal(sends().length, 0, 'queued: nothing is sent now');
  assert.equal(uploads().length, 1, 'the files are uploaded once');
  // Queued on the server at once, the same as queueing during a turn.
  assert.equal(appendQueuedMessage.mock.calls.length, 1);
  assert.equal(appendQueuedMessage.mock.calls[0]?.[0], 'session-1');
  const stored = readQueuedMessage('session-1');
  assert.equal(stored?.content, 'hello');
  assert.deepEqual(stored?.attachments, [UPLOADED]);
  assert.equal(stored?.options?.model, 'test-model');
  assert.equal(view.result.current.queuedDraft?.content, 'hello', 'the queued card shows the message');
  assert.equal(view.result.current.input, '', 'and the composer is cleared, as when queueing during a turn');
  assert.equal(view.result.current.attachedFiles.length, 0);
});

test('a second message while the first is queued joins the queue instead of sending', async () => {
  const { view, sends } = render(backgroundOnly);
  await act(async () => { view.result.current.setInput('first'); });
  await submit(view);
  await act(async () => { view.result.current.setInput('second'); });
  await submit(view);

  assert.equal(sends().length, 0);
  await waitFor(() => assert.equal(appendQueuedMessage.mock.calls.length, 2));
});

test('a session with nothing in the background sends at once', async () => {
  const { view, sends } = render(new Map());
  await act(async () => { view.result.current.setInput('hello'); });
  await submit(view);

  assert.equal(sends().length, 1);
  assert.equal(appendQueuedMessage.mock.calls.length, 0);
});

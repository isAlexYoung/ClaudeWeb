import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import { useChatComposerState } from '@/modules/chat/hooks/useChatComposerState';
import type { ChatMessage, PermissionMode, Project, ProjectSession } from '@/shared/types';

/**
 * Regenerate runs the last user message again as it was sent: the same
 * `chat.edit-send` an edit uses, with the original text and attachments,
 * leaving whatever is in the composer untouched.
 */

const PROJECT: Project = { projectId: 'project-1', displayName: 'Project One', fullPath: '/tmp/project-one' };
const SESSION: ProjectSession = { id: 'session-1' };
const IMAGE = { name: 'shot.png', path: '/uploads/shot.png', mimeType: 'image/png', size: 5 };

const render = (isLoading = false) => {
  const sent: Array<Record<string, unknown>> = [];
  const added: ChatMessage[] = [];
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
      isLoading,
      processingSessions: new Map(),
      canAbortSession: false,
      tokenBudget: null,
      sendMessage: (message) => { sent.push(message as Record<string, unknown>); },
      scrollToBottom: () => undefined,
      addMessage: (message) => { added.push(message as ChatMessage); },
      setIsUserScrolledUp: () => undefined,
      setPendingPermissionRequests: () => undefined,
    }),
  );
  return { view, sent, added };
};

const LAST_USER: ChatMessage = {
  type: 'user',
  content: 'Summarise this screenshot',
  timestamp: '2026-11-16T10:00:00.000Z',
  transcriptAnchorId: 'anchor-2',
  images: [IMAGE] as never,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('regenerate resends the message as an edit of itself, with its attachments, and keeps the draft', async () => {
  const { view, sent, added } = render();
  await act(async () => { view.result.current.setInput('a draft I am still writing'); });
  await act(async () => { view.result.current.regenerateFromMessage(LAST_USER); });

  assert.equal(sent.length, 1);
  const frame = sent[0] as { type: string; sessionId: string; anchorId: string; content: string; options: { attachments: unknown[]; model?: string } };
  assert.equal(frame.type, 'chat.edit-send');
  assert.equal(frame.sessionId, 'session-1');
  assert.equal(frame.anchorId, 'anchor-2');
  assert.equal(frame.content, 'Summarise this screenshot');
  assert.deepEqual(frame.options.attachments, [IMAGE]);
  assert.equal(frame.options.model, 'test-model');
  // The echo replaces the old turn, as an edit's does.
  assert.equal(added[0]?.replacesAnchorId, 'anchor-2');
  assert.equal(added[0]?.transcriptAnchorId, 'anchor-2', 'a stopped replacement retains its existing edit anchor until persisted history arrives');
  assert.equal(view.result.current.input, 'a draft I am still writing');
});

test('regenerate does nothing while a turn runs or for a message without an anchor', async () => {
  const busy = render(true);
  await act(async () => { busy.view.result.current.regenerateFromMessage(LAST_USER); });
  assert.equal(busy.sent.length, 0);

  const idle = render();
  await act(async () => { idle.view.result.current.regenerateFromMessage({ ...LAST_USER, transcriptAnchorId: undefined }); });
  assert.equal(idle.sent.length, 0);
});

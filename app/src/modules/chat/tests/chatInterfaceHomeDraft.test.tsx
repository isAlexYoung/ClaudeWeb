import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import '@/modules/i18n';
import type { Project } from '@/shared/types';

/**
 * Scheduled tasks hands a prompt to the next Chat landing page (a template, or
 * "Create with Claude"). ChatInterface must file it under the landing draft
 * scope of the chat workspace, once, and never under whatever project or
 * conversation happens to be selected during the navigation.
 */

const harness = vi.hoisted(() => ({
  experience: {
    home: true,
    mode: 'chat',
    homeDraft: 'Help me set up a scheduled task.' as string | null,
    consumeHomeDraft: vi.fn(),
    setContextUsage: () => {},
  },
  writeDraftText: vi.fn(),
}));

vi.mock('@/shared/chatDrafts', () => ({ writeDraftText: harness.writeDraftText }));
vi.mock('@/shared/context/WorkspaceExperienceContext', () => ({ useWorkspaceExperience: () => harness.experience }));
vi.mock('@/shared/context/UiPreferencesContext', () => ({ useUiPreferences: () => ({ chatMcpEnabled: false }) }));
vi.mock('@/modules/chat/composer/useScheduledMessages', () => ({
  useScheduledMessages: () => ({ scheduledMessages: [], schedule: async () => null, cancel: async () => false }),
}));
vi.mock('@/shared/context/WebSocketContext', () => ({ useWebSocket: () => ({ subscribe: () => () => {} }) }));
vi.mock('@/shared/context/SessionProtectionContext', () => ({
  useProcessingSessions: () => new Map(),
  useSessionProtectionActions: () => ({
    markSessionProcessing: () => {},
    markSessionIdle: () => {},
    markSessionBackground: () => {},
    getSessionActivity: () => null,
  }),
}));
vi.mock('@/modules/task-master', () => ({
  useTasksSettings: () => ({ tasksEnabled: false, isTaskMasterInstalled: false }),
  useComposerTaskMenu: () => ({ menu: null, setupDialog: null }),
}));
vi.mock('@/modules/side-chat', () => ({ SelectionTools: () => null, QuoteDrafts: () => null, useTextQuotes: () => ({ quotes: [], addQuote: () => {}, removeQuotes: () => {} }) }));
vi.mock('@/modules/command-palette', () => ({ usePaletteOpsRegister: () => {} }));
vi.mock('@/modules/chat/hooks/useChatProviderState', () => ({
  useChatProviderState: () => ({ provider: 'claude', pendingPermissionRequests: [] }),
}));
vi.mock('@/modules/chat/hooks/useChatSessionState', () => ({
  useChatSessionState: () => ({
    chatMessages: [],
    // A conversation id left over from before New Chat must not attract the draft.
    currentSessionId: 'previous-session',
    setCurrentSessionId: () => {},
    requestLatestMessages: async () => {},
  }),
}));
vi.mock('@/modules/chat/hooks/useChatRealtimeHandlers', () => ({ useChatRealtimeHandlers: () => {} }));
vi.mock('@/modules/chat/hooks/useChatComposerState', () => ({
  useChatComposerState: () => ({ input: '', attachedFiles: [], setInput: () => {}, textareaRef: { current: null } }),
}));
vi.mock('@/modules/chat/hooks/useSessionStore', () => ({ useSessionStore: () => ({}) }));
vi.mock('@/modules/chat/transcript/ChatMessagesPane', () => ({ default: () => null }));
vi.mock('@/modules/chat/transcript/ChatTurnNavigator', () => ({ default: () => null }));
vi.mock('@/modules/chat/composer/ChatComposer', () => ({ default: () => null }));
vi.mock('@/modules/chat/modals/CommandResultModal', () => ({ default: () => null }));
// The landing greeting reads the signed-in user; it is not what this file tests.
vi.mock('@/modules/chat/ChatHomeGreeting', () => ({ ChatHomeGreeting: () => null }));

const { default: ChatInterface } = await import('@/modules/chat/ChatInterface');

const chatWorkspace: Project = { projectId: 'chat-ws', displayName: 'Chat', fullPath: '/home/claudeweb', path: '/home/claudeweb' };
const otherProject: Project = { projectId: 'repo', displayName: 'repo', fullPath: '/work/repo', path: '/work/repo' };

const renderWith = (project: Project) => render(
  <ChatInterface isActive selectedProject={project} selectedSession={null} ws={null} sendMessage={() => {}} />,
);

beforeEach(() => {
  harness.writeDraftText.mockReset();
  harness.experience.consumeHomeDraft.mockReset();
  harness.experience.homeDraft = 'Help me set up a scheduled task.';
  harness.experience.home = true;
  harness.experience.mode = 'chat';
});

test('a handed-over prompt becomes the chat workspace landing draft, once', () => {
  renderWith(chatWorkspace);
  assert.deepEqual(harness.writeDraftText.mock.calls, [['project:chat-ws', 'Help me set up a scheduled task.']]);
  assert.equal(harness.experience.consumeHomeDraft.mock.calls.length, 1);
});

test('the prompt waits while another project is still selected', () => {
  renderWith(otherProject);
  assert.equal(harness.writeDraftText.mock.calls.length, 0);
  assert.equal(harness.experience.consumeHomeDraft.mock.calls.length, 0);
});

test('nothing is written outside the Chat landing page or without a prompt', () => {
  harness.experience.mode = 'project';
  renderWith(chatWorkspace);
  harness.experience.mode = 'chat';
  harness.experience.homeDraft = null;
  renderWith(chatWorkspace);
  assert.equal(harness.writeDraftText.mock.calls.length, 0);
});

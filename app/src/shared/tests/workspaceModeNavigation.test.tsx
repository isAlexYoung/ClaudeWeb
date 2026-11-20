import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceExperienceProvider, useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

beforeEach(() => {
  resetUserPreferences();
  writeUserPreference('workspaceSessions', { chatSessionIds: ['chat-a'], pinnedSessionIds: [] });
});

describe('Chat and Code navigation memories', () => {
  it('remembers a legacy Chat-directory classification when subsequent URL navigation supplies only an id', () => {
    const { result } = renderHook(useWorkspaceExperience, { wrapper: WorkspaceExperienceProvider });
    act(() => result.current.enterSession('legacy-chat', 'chat'));
    act(() => result.current.enterSession('code-a'));
    act(() => result.current.enterSession('legacy-chat'));
    expect(result.current.mode).toBe('chat');
    expect(result.current.chatSessionIds).toContain('legacy-chat');
    act(() => result.current.switchMode('project'));
    expect(result.current.resumeSessionId).toBe('code-a');
  });
  it('returns to each mode\'s original session, rather than creating a new chat', () => {
    const { result } = renderHook(useWorkspaceExperience, { wrapper: WorkspaceExperienceProvider });
    act(() => result.current.enterSession('code-a'));
    act(() => result.current.switchMode('chat'));
    expect(result.current.home).toBe(true);
    act(() => result.current.enterSession('chat-a'));
    const request = result.current.homeRequest;
    act(() => result.current.switchMode('project'));
    expect(result.current.mode).toBe('project');
    expect(result.current.home).toBe(false);
    expect(result.current.resumeSessionId).toBe('code-a');
    expect(result.current.homeRequest).toBe(request);
    act(() => result.current.enterSession('code-a'));
    act(() => result.current.switchMode('chat'));
    expect(result.current.resumeSessionId).toBe('chat-a');
    expect(result.current.home).toBe(false);
  });

  it('explicit New Chat clears only that mode\'s remembered session', () => {
    const { result } = renderHook(useWorkspaceExperience, { wrapper: WorkspaceExperienceProvider });
    act(() => result.current.enterSession('code-a'));
    act(() => result.current.enterSession('chat-a'));
    act(() => result.current.switchMode('project'));
    act(() => result.current.openHome('project'));
    expect(result.current.resumeSessionId).toBeNull();
    act(() => result.current.switchMode('chat'));
    expect(result.current.resumeSessionId).toBe('chat-a');
    act(() => result.current.enterSession('chat-a'));
    act(() => result.current.switchMode('project'));
    expect(result.current.home).toBe(true);
    expect(result.current.resumeSessionId).toBeNull();
  });

  it('clicking the selected mode does not reset the current task', () => {
    const { result } = renderHook(useWorkspaceExperience, { wrapper: WorkspaceExperienceProvider });
    act(() => result.current.enterSession('code-a'));
    const request = result.current.homeRequest;
    act(() => result.current.switchMode('project'));
    expect(result.current.home).toBe(false);
    expect(result.current.homeRequest).toBe(request);
  });

  it('remembers a just-created session before it appears in the sidebar', () => {
    const { result } = renderHook(useWorkspaceExperience, { wrapper: WorkspaceExperienceProvider });
    act(() => result.current.openHome('project'));
    act(() => result.current.rememberSession('new-code'));
    act(() => result.current.switchMode('chat'));
    act(() => result.current.switchMode('project'));
    expect(result.current.resumeSessionId).toBe('new-code');
  });
});

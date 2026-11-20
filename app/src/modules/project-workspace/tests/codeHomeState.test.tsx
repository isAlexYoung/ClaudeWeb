import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
import { WorkspaceExperienceProvider, useWorkspaceExperience } from '@/shared/context/WorkspaceExperienceContext';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import type { Project } from '@/shared/types';

const fixture = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: {
  projects: () => fixture.list(), createProject: (input: unknown) => fixture.create(input),
  projectTaskmaster: async () => ({ ok: false }), sessionDetails: async () => ({ ok: false }),
  projectSessions: async () => ({ ok: false }),
  user: { savePreferences: async () => ({ ok: true, json: async () => ({}) }) },
} }));
const project = (projectId: string, fullPath: string): Project => ({ projectId, fullPath, path: fullPath, displayName: projectId, sessions: [] });
const chat = project('chat', '/home/wdguest');
const code = project('code', '/home/wdguest/Code');
const custom = project('custom', '/home/wdguest/projects/custom');
const ok = (value: unknown) => ({ ok: true, json: async () => value });
const navigate = vi.fn();
const subscribe = () => () => {};
const busy = () => false;
const setup = (sessionId?: string) => renderHook(() => ({
  state: useProjectsState({ navigate, sessionId, isMobile: false, subscribe, isSessionProcessing: busy }),
  experience: useWorkspaceExperience(),
}), { wrapper: WorkspaceExperienceProvider });

beforeEach(() => {
  localStorage.clear(); resetUserPreferences(); navigate.mockClear();
  fixture.list.mockReset().mockResolvedValue(ok([chat, custom]));
  fixture.create.mockReset().mockResolvedValue(ok({ project: code }));
});

describe('Code home working directory and resume routing', () => {
  it('keeps Code navigation when delayed preferences classify the open project session as Chat', async () => {
    fixture.list.mockResolvedValue(ok([{ ...code, sessions: [{ id: 'code-session', summary: 'Code task' }] }, chat]));
    const { result } = setup('code-session');
    await waitFor(() => expect(result.current.state.selectedSession?.id).toBe('code-session'));
    expect(result.current.experience.mode).toBe('project');
    act(() => writeUserPreference('workspaceSessions', { chatSessionIds: ['code-session'], pinnedSessionIds: [] }));
    await act(async () => result.current.state.refreshProjectsSilently());
    expect(result.current.experience.mode).toBe('project');
    expect(result.current.state.projects.some(project => project.projectId === 'code')).toBe(true);
  });
  it('classifies a direct link to a legacy Chat-directory session after projects load', async () => {
    fixture.list.mockResolvedValue(ok([{ ...chat, sessions: [{ id: 'legacy-chat', summary: 'Old chat' }] }, custom]));
    const { result } = setup('legacy-chat');
    await waitFor(() => expect(result.current.state.selectedSession?.id).toBe('legacy-chat'));
    expect(result.current.experience.mode).toBe('chat');
    expect(result.current.experience.chatSessionIds).toContain('legacy-chat');
    expect(result.current.experience.home).toBe(false);
    act(() => result.current.experience.switchMode('project'));
    expect(result.current.experience.home).toBe(true);
    expect(result.current.experience.resumeSessionId).toBeNull();
  });
  it('registers the default folder, lets the user choose a folder without leaving home, and reuses the default', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('chat'));
    act(() => result.current.experience.openHome('project'));
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('code'));
    expect(fixture.create).toHaveBeenCalledWith({ path: '/home/wdguest/Code', customName: 'Code' });
    const trigger = result.current.state.newSessionTrigger;
    act(() => result.current.experience.selectHomeProject(custom));
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('custom'));
    expect(result.current.experience.home).toBe(true);
    expect(result.current.state.newSessionTrigger).toBe(trigger);
    act(() => result.current.experience.selectHomeProject(null));
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('code'));
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it('a late default-folder response does not replace a project the user chose meanwhile', async () => {
    let finish!: (response: ReturnType<typeof ok>) => void;
    fixture.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = setup();
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('chat'));
    act(() => result.current.experience.openHome('project'));
    await waitFor(() => expect(fixture.create).toHaveBeenCalledTimes(1));
    act(() => result.current.experience.selectHomeProject(custom));
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('custom'));
    await act(async () => finish(ok({ project: code })));
    expect(result.current.state.selectedProject?.projectId).toBe('custom');
    act(() => result.current.experience.selectHomeProject(null));
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('code'));
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it('recovers a concurrently registered default folder after a 409', async () => {
    fixture.create.mockResolvedValue({ ok: false, status: 409 });
    fixture.list.mockResolvedValueOnce(ok([chat, custom])).mockResolvedValue(ok([chat, custom, code]));
    const { result } = setup();
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('chat'));
    act(() => result.current.experience.openHome('project'));
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('code'));
    expect(result.current.experience.homeError).toBeNull();
  });

  it('a mode resume intent goes to the remembered session route', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.state.selectedProject?.projectId).toBe('chat'));
    act(() => result.current.experience.enterSession('code-session'));
    act(() => result.current.experience.switchMode('chat'));
    act(() => result.current.experience.switchMode('project'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/session/code-session'));
  });
});

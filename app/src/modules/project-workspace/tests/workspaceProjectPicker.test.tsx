import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import WorkspaceProjectPicker from '@/modules/project-workspace/WorkspaceProjectPicker';
import { WorkspaceExperienceProvider } from '@/shared/context/WorkspaceExperienceContext';
import { resetUserPreferences } from '@/shared/userSettings';

const fixture = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/modules/project-workspace/context/ProjectsStateContext', () => ({ useProjectSidebarState: () => ({ sidebarSharedProps: {
  onRefresh: fixture.refresh,
  projects: [
    { projectId: 'chat', fullPath: '/home/wdguest', displayName: 'Chat' },
    { projectId: 'code', fullPath: '/home/wdguest/Code', displayName: 'Code' },
    { projectId: 'api', fullPath: '/home/wdguest/projects/api', displayName: 'API' },
  ],
} }) }));
vi.mock('@/modules/project-creation-wizard', () => ({ ProjectCreationWizard: ({ onClose, onProjectCreated }: { onClose: () => void; onProjectCreated: (project: unknown) => void }) =>
  <div role="dialog" aria-label="Create project"><button onClick={onClose}>Cancel creation</button><button onClick={() => onProjectCreated({ projectId: 'new', fullPath: '/home/wdguest/projects/new', displayName: 'New folder' })}>Finish creation</button></div>,
}));

beforeEach(async () => { resetUserPreferences(); fixture.refresh.mockClear(); await i18n.changeLanguage('en'); });

describe('Code landing folder menu', () => {
  it('offers the default folder, existing projects and create, with no duplicated reserved directories', () => {
    render(<WorkspaceProjectPicker />, { wrapper: WorkspaceExperienceProvider });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);
    expect(screen.getByRole('menuitemradio', { name: /Default folder/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /API/ }));
    expect(screen.getByRole('button', { name: 'API' })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape dismisses the upward menu and restores the trigger focus', async () => {
    render(<WorkspaceProjectPicker />, { wrapper: WorkspaceExperienceProvider });
    const trigger = screen.getByRole('button', { name: 'Choose folder' });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('creates at page level, refreshes the project list and selects the created folder in place', () => {
    const view = render(<WorkspaceProjectPicker />, { wrapper: WorkspaceExperienceProvider });
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Create project' }));
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    expect(dialog.parentElement).toBe(document.body);
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Finish creation' }));
    expect(fixture.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

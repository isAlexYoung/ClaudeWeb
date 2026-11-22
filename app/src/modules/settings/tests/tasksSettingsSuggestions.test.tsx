import { fireEvent, render } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import TasksSettingsTab from '@/modules/settings/tabs/tasks-settings/TasksSettingsTab';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { readUserPreference, resetUserPreferences } from '@/shared/userSettings';

/** The next-prompt suggestion switch lives in Settings > Tasks and sessions, beside the archive. */

vi.mock('@/modules/task-master', () => ({
  useTasksSettings: () => ({ tasksEnabled: false, setTasksEnabled: vi.fn(), isTaskMasterInstalled: false, isCheckingInstallation: false }),
}));
vi.mock('@/modules/settings/tabs/tasks-settings/ArchivedSessionsSection', () => ({ default: () => <div data-testid="archive" /> }));
vi.mock('@/shared/api', () => ({ api: { user: { savePreferences: async () => ({ ok: true }) } } }));

beforeAll(async () => { await i18n.changeLanguage('en'); });

it('shows the suggestion switch above the archive and toggles the preference', () => {
  const view = render(<UiPreferencesProvider><TasksSettingsTab /></UiPreferencesProvider>);
  const toggle = view.getByRole('switch', { name: 'Next-prompt suggestions' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  expect(toggle.compareDocumentPosition(view.getByTestId('archive')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

it('stores the inactive-session archive period the server archiver reads', () => {
  resetUserPreferences();
  const view = render(<UiPreferencesProvider><TasksSettingsTab /></UiPreferencesProvider>);
  const select = view.getByRole('combobox', { name: 'Archive inactive sessions' }) as HTMLSelectElement;
  expect(select.value).toBe('0');
  expect([...select.options].map((option) => option.textContent)).toEqual(['Never', 'After 1 day', 'After 3 days', 'After 7 days', 'After 14 days', 'After 30 days']);
  fireEvent.change(select, { target: { value: '7' } });
  expect(readUserPreference('autoArchiveInactiveDays', 0)).toBe(7);
  expect(select.value).toBe('7');
});

it('turns the change summary card off and on', () => {
  const view = render(<UiPreferencesProvider><TasksSettingsTab /></UiPreferencesProvider>);
  const toggle = view.getByRole('switch', { name: 'Change summary card' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-checked')).toBe('false');
});

it('moves the permission mode here while preserving existing saved tool rules', () => {
  const change = vi.fn();
  const permissions = { skipPermissions: false, allowedTools: ['Read'], disallowedTools: ['Bash(rm:*)'] };
  const view = render(<UiPreferencesProvider><TasksSettingsTab claudePermissions={permissions} onClaudePermissionsChange={change} /></UiPreferencesProvider>);
  fireEvent.click(view.getByRole('switch', { name: /Skip permission prompts/i }));
  expect(change).toHaveBeenCalledWith({ ...permissions, skipPermissions: true });
  expect(view.queryByText('Allowed tools')).toBeNull();
  expect(view.queryByText('Blocked tools')).toBeNull();
});

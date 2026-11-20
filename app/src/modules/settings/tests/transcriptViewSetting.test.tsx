import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import AppearanceSettingsTab from '@/modules/settings/tabs/AppearanceSettingsTab';
import { UiPreferencesProvider, useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { resetUserPreferences } from '@/shared/userSettings';

/** Appearance > Default transcript view sets the two transcript preferences together, like Claude Code's Normal / Thinking / Verbose. */

vi.mock('@/modules/settings/ThemeCards', () => ({ default: () => null }));
vi.mock('@/modules/i18n', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), LanguageSelector: () => null }));
vi.mock('@/shared/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  api: { user: { savePreferences: async () => ({ ok: true }) } },
}));

beforeAll(async () => { await i18n.changeLanguage('en'); });
afterEach(() => { resetUserPreferences(); });

function Probe() {
  const { showThinking, showRawParameters } = useUiPreferences();
  return <span data-testid="probe">{`${showThinking}/${showRawParameters}`}</span>;
}

const noop = () => {};
const renderTab = () => render(
  <UiPreferencesProvider>
    <AppearanceSettingsTab
      projectSortOrder="name"
      onProjectSortOrderChange={noop}
      codeEditorSettings={{ theme: 'dark', wordWrap: false, showMinimap: false, lineNumbers: true, fontSize: '14' } as never}
      onCodeEditorWordWrapChange={noop}
      onCodeEditorShowMinimapChange={noop}
      onCodeEditorLineNumbersChange={noop}
      onCodeEditorFontSizeChange={noop}
    />
    <Probe />
  </UiPreferencesProvider>,
);

it('starts on Thinking and maps each view onto showThinking and showRawParameters', () => {
  renderTab();
  const select = screen.getByRole('combobox', { name: 'Default transcript view' }) as HTMLSelectElement;
  expect(select.value).toBe('thinking');
  expect([...select.options].map((option) => option.textContent)).toEqual(['Normal', 'Thinking', 'Verbose']);

  fireEvent.change(select, { target: { value: 'verbose' } });
  expect(screen.getByTestId('probe').textContent).toBe('true/true');
  expect(screen.getByText(/raw parameters of each tool call/)).toBeTruthy();

  fireEvent.change(select, { target: { value: 'normal' } });
  expect(screen.getByTestId('probe').textContent).toBe('false/false');
  expect(select.value).toBe('normal');
});

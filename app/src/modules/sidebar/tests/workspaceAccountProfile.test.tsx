import assert from 'node:assert/strict';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, test, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import WorkspaceAccount from '@/modules/sidebar/WorkspaceAccount';

vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { username: 'platform-user' }, logout: () => {} }) }));

/** The name and photo from Settings > General label the bottom-left account button, and only that. */

const AVATAR = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

afterEach(() => {
  resetUserPreferences();
});

test('the account button shows the profile name and photo, and falls back to the login name', () => {
  const { container, unmount } = render(<WorkspaceAccount onSettings={() => {}} />);
  assert.ok(screen.getByText('platform-user'));
  assert.equal(container.querySelector('.workspace-account-avatar img'), null);

  act(() => {
    writeUserPreference('workspaceProfile', { displayName: 'Alex', avatar: AVATAR });
  });
  assert.ok(screen.getByText('Alex'));
  assert.equal(container.querySelector('.workspace-account-avatar img')?.getAttribute('src'), AVATAR);
  unmount();
});

test('Usage in the account menu opens Settings on its Usage tab; the gear opens Settings as it was', () => {
  const onSettings = vi.fn();
  const { unmount } = render(<WorkspaceAccount onSettings={onSettings} />);
  fireEvent.click(screen.getByRole('button', { name: /platform-user/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Usage' }));
  assert.deepEqual(onSettings.mock.calls, [['usage']]);
  assert.equal(screen.queryByRole('dialog'), null, 'no separate usage dialog any more');

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  assert.deepEqual(onSettings.mock.calls.at(-1), []);
  unmount();
});

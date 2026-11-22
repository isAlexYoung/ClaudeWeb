import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import AgentsSettingsTab from '@/modules/settings/tabs/agents-settings/AgentsSettingsTab';
import NotificationsSettingsTab from '@/modules/settings/tabs/NotificationsSettingsTab';

vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { username: 'preview' } }) }));
vi.mock('@/shared/context/UiPreferencesContext', () => ({ useUiPreferences: () => ({ chatMcpEnabled: false }), useSetUiPreference: () => vi.fn() }));
vi.mock('@/modules/settings/tabs/LoginDevicesSection', () => ({ default: () => <div>Signed-in devices</div> }));
vi.mock('@/modules/settings/tabs/agents-settings/ClaudeNameField', () => ({ default: () => <input aria-label="What should Claude call you?" /> }));

describe('Account settings', () => {
  it('keeps profile, Claude name and sign-in together without unrelated extension or permission settings', () => {
    const login = vi.fn();
    render(<AgentsSettingsTab
      providerAuthStatus={{ claude: { authenticated: false, loading: false, email: null, method: null, error: 'Claude CLI is not authenticated. Run claude /login', installedVersion: '2.1.325' } }}
      onProviderLogin={login}
    />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('2.1.325', { exact: false })).toBeNull();
    expect(screen.queryByText('Claude CLI is not authenticated.', { exact: false })).toBeNull();
    expect(screen.getByLabelText('What should Claude call you?')).toBeTruthy();
    expect(screen.getByText('Signed-in devices')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Login$/ }));
    expect(login).toHaveBeenCalledWith('claude');
  });

  it('keeps notification controls functional without decorative icons or checkboxes', async () => {
    const change = vi.fn(), enable = vi.fn();
    const { container } = render(<NotificationsSettingsTab
      notificationPreferences={{ channels: { inApp: true, webPush: false, desktop: false, sound: true }, events: { actionRequired: true, stop: true, error: true } }}
      onNotificationPreferencesChange={change} pushPermission="default" isPushSubscribed={false} isPushLoading={false}
      onEnablePush={enable} onDisablePush={vi.fn()}
    />);
    expect(within(container).getAllByRole('switch')).toHaveLength(5);
    expect(container.querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable notifications' }));
    expect(enable).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('switch', { name: 'Sound' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(expect.objectContaining({ channels: expect.objectContaining({ sound: false }) })));
  });
});

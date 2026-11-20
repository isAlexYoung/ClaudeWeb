import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import AgentsSettingsTab from '@/modules/settings/tabs/agents-settings/AgentsSettingsTab';
import NotificationsSettingsTab from '@/modules/settings/tabs/NotificationsSettingsTab';

vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { username: 'preview' } }) }));
vi.mock('@/shared/context/UiPreferencesContext', () => ({ useUiPreferences: () => ({ chatMcpEnabled: false }), useSetUiPreference: () => vi.fn() }));
vi.mock('@/modules/mcp', () => ({ McpServers: ({ children }: { children?: ReactNode }) => <div>MCP server controls{children}</div> }));
vi.mock('@/modules/skills', () => ({ ProviderSkills: () => <div>Skill controls</div> }));
vi.mock('@/modules/settings/hooks/useClaudeSettingsPermissionRules', () => ({ useClaudeSettingsPermissionRules: () => ({ sources: [], loadFailed: false }) }));

describe('General settings continuous page', () => {
  it('keeps sign-in, tool rules, MCP and skills on one page and preserves permission values when toggled', () => {
    const login = vi.fn(), permissions = vi.fn();
    render(<AgentsSettingsTab
      providerAuthStatus={{ claude: { authenticated: false, loading: false, email: null, method: null, error: 'Claude CLI is not authenticated. Run claude /login', installedVersion: '2.1.325' } }}
      onProviderLogin={login} claudePermissions={{ skipPermissions: false, allowedTools: ['Read'], disallowedTools: ['Bash(rm:*)'] }}
      onClaudePermissionsChange={permissions} projects={[]}
    />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('2.1.325', { exact: false })).toBeNull();
    expect(screen.queryByText('Claude CLI is not authenticated.', { exact: false })).toBeNull();
    expect(screen.getByText('MCP server controls')).toBeTruthy();
    expect(screen.getByText('Skill controls')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Login$/ }));
    expect(login).toHaveBeenCalledWith('claude');
    fireEvent.click(screen.getByRole('switch', { name: /Skip permission prompts/i }));
    expect(permissions).toHaveBeenLastCalledWith({ skipPermissions: true, allowedTools: ['Read'], disallowedTools: ['Bash(rm:*)'] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Read' }));
    expect(permissions).toHaveBeenLastCalledWith({ skipPermissions: false, allowedTools: [], disallowedTools: ['Bash(rm:*)'] });
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

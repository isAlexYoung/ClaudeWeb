import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import PluginsSettingsTab from '@/modules/settings/tabs/PluginsSettingsTab';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import type { SettingsExtensionRefreshRegistration } from '@/shared/types';

const mocks = vi.hoisted(() => ({ plugins: vi.fn(async () => {}), mcp: vi.fn(async () => {}), skills: vi.fn(async () => {}) }));
vi.mock('@/modules/plugins', () => ({ PluginSettingsTab: () => <div>Plugins</div>, usePlugins: () => ({ refreshPlugins: mocks.plugins }) }));
vi.mock('@/modules/mcp', () => ({ McpServers: ({ onRefreshReady }: { onRefreshReady: SettingsExtensionRefreshRegistration }) => {
  useEffect(() => { onRefreshReady(mocks.mcp); return () => onRefreshReady(null); }, [onRefreshReady]);
  return <div>MCP</div>;
} }));
vi.mock('@/modules/skills', () => ({ ProviderSkills: ({ onRefreshReady }: { onRefreshReady: SettingsExtensionRefreshRegistration }) => {
  useEffect(() => { onRefreshReady(mocks.skills); return () => onRefreshReady(null); }, [onRefreshReady]);
  return <div>Skills</div>;
} }));

it('one refresh action reloads all lists and remains disabled until every request settles', async () => {
  await i18n.changeLanguage('en');
  let finish!: () => void;
  mocks.mcp.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<UiPreferencesProvider><PluginsSettingsTab projects={[]} /></UiPreferencesProvider>);
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.click(refresh);
  expect(mocks.plugins).toHaveBeenCalledTimes(1);
  expect(mocks.mcp).toHaveBeenCalledTimes(1);
  expect(mocks.skills).toHaveBeenCalledTimes(1);
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  finish();
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
});

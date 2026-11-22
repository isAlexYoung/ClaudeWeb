import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import { PluginsProvider } from '@/modules/plugins/context/PluginsContext';
import PluginSettingsTab from '@/modules/plugins/PluginSettingsTab';
import type { Plugin } from '@/shared/types';

const customPlugin: Plugin = {
  name: 'workspace-note', displayName: 'Workspace Note', version: '1.0.0',
  description: '', author: '', icon: '', type: 'module', slot: 'tab',
  entry: 'index.js', server: null, permissions: [], enabled: true,
  serverRunning: false, dirName: 'workspace-note', repoUrl: 'https://example.test/workspace-note',
};

afterEach(() => vi.unstubAllGlobals());

it('offers only custom installation, then supports disabling and removing the installed plugin', async () => {
  let plugins: Plugin[] = [];
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/plugins/install') {
      expect(JSON.parse(String(options?.body))).toEqual({ url: customPlugin.repoUrl });
      plugins = [{ ...customPlugin }];
    } else if (url === '/api/plugins/workspace-note/enable') {
      expect(JSON.parse(String(options?.body))).toEqual({ enabled: false });
      plugins = [{ ...customPlugin, enabled: false }];
    } else if (url === '/api/plugins/workspace-note' && options?.method === 'DELETE') {
      plugins = [];
    }
    return new Response(JSON.stringify(url === '/api/plugins' ? { plugins } : { success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<PluginsProvider><PluginSettingsTab /></PluginsProvider>);

  expect(await screen.findByText('No plugins installed')).toBeTruthy();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Custom plugins' }).getAttribute('href'))
    .toBe('https://github.com/isAlexYoung/ClaudeWeb/blob/main/doc/CUSTOM_PLUGINS.md');
  expect(screen.queryByText('Project Stats')).toBeNull();

  const input = screen.getByLabelText('Plugin git repository URL');
  fireEvent.change(input, { target: { value: customPlugin.repoUrl } });
  fireEvent.click(screen.getByRole('button', { name: /^Install$/ }));
  expect(await screen.findByText('Workspace Note')).toBeTruthy();
  await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));

  fireEvent.click(screen.getByRole('checkbox', { name: 'Disable Workspace Note' }));
  await screen.findByRole('checkbox', { name: 'Enable Workspace Note' });
  fireEvent.click(screen.getByRole('button', { name: 'Uninstall plugin' }));
  expect(screen.getByText('Workspace Note')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url, options]) => url === '/api/plugins/workspace-note' && options?.method === 'DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^Remove$/ }));
  await waitFor(() => expect(screen.queryByText('Workspace Note')).toBeNull());
  expect(await screen.findByText('No plugins installed')).toBeTruthy();
});

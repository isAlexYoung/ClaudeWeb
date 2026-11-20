import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import '@/modules/i18n';
import { PluginsProvider } from '@/modules/plugins/context/PluginsContext';
import PluginSettingsTab from '@/modules/plugins/PluginSettingsTab';
import type { Plugin } from '@/shared/types';

/**
 * ClaudeWeb installs the Claude usage plugin to drive the composer's quota
 * ring, so Settings > Plugins neither lists it nor recommends installing it.
 */

const plugin = (name: string, displayName: string): Plugin => ({
  name,
  displayName,
  version: '1.0.0',
  description: '',
  author: '',
  icon: '',
  type: 'module',
  slot: 'tab',
  entry: 'index.js',
  server: null,
  permissions: [],
  enabled: true,
  serverRunning: false,
  dirName: name,
  repoUrl: null,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('hides the built-in usage plugin and its recommendation, and still lists other plugins', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    JSON.stringify(url === '/api/plugins'
      ? { plugins: [plugin('claude-usage', 'Claude Usage'), plugin('project-stats', 'Project Stats')] }
      : {}),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )));

  render(
    <PluginsProvider>
      <PluginSettingsTab />
    </PluginsProvider>,
  );

  expect(await screen.findByText('Project Stats')).toBeTruthy();
  expect(screen.queryByText('Claude Usage')).toBeNull();
  expect(screen.queryByText(/claude-usage/i)).toBeNull();
});

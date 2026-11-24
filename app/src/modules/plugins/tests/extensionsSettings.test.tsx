import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { i18n } from '@/modules/i18n';
import { PluginsProvider } from '@/modules/plugins/context/PluginsContext';
import ExtensionsSettingsPage from '@/modules/plugins/ExtensionsSettingsPage';
import PluginsPage from '@/modules/plugins/PluginsPage';
import type { Plugin, ProviderMcpServer, ProviderSkill } from '@/shared/types';

let plugins: Plugin[];
let connectors: ProviderMcpServer[];
let skills: ProviderSkill[];
let rejectToggle = false;
let fixtureId = 0;
const plugin = (name: string, enabled = true): Plugin => ({ name, displayName: name, version: '1.0.0', description: 'Custom wallpaper and glass effects', author: '', icon: '', type: 'module', slot: 'settings', slots: ['settings'], entry: 'index.js', server: null, permissions: [], enabled, serverRunning: false, dirName: name, repoUrl: null });
const connector = (name: string, enabled = true): ProviderMcpServer => ({ provider: 'claude', name, enabled, scope: 'user', transport: 'stdio', command: '/private/python', args: ['secret-argument'], env: { SECRET: 'private-value' } });
const skill = (name: string, enabled = true): ProviderSkill => ({ provider: 'claude', name, enabled, description: 'Summarize lengthy conversations', command: `/${name}`, scope: 'user', sourcePath: `/skills/${name}/SKILL.md` });

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear(); sessionStorage.clear(); rejectToggle = false;
  plugins = [plugin('Wallpaper'), plugin('Stats', false), plugin('claude-usage')];
  connectors = [connector('windows-pc-files'), connector('Docs', false)];
  skills = [skill('Summary'), skill('Notes', false)];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const address = new URL(String(input), 'http://localhost');
    const path = address.pathname;
    const body = options?.body ? JSON.parse(String(options.body)) : {};
    if (path === '/api/plugins') return Response.json({ plugins });
    if (path === '/api/plugins/install') { plugins.push(plugin('New Plugin')); return Response.json({ success: true }); }
    if (path.endsWith('/mcp/servers')) {
      if (options?.method === 'POST') {
        const created = { ...connector(body.name), ...body };
        connectors.push(created);
        return Response.json({ success: true, data: { server: created } });
      }
      return Response.json({ success: true, data: { servers: address.searchParams.get('scope') === 'user' ? connectors : [] } });
    }
    if (path.endsWith('/skills/import')) { skills.push(skill('Linked Skill')); return Response.json({ success: true, data: { skills } }); }
    if (path.endsWith('/skills')) return Response.json({ success: true, data: { skills: address.searchParams.has('workspacePath') ? [] : skills } });
    if (path.endsWith('/skills/state')) {
      if (rejectToggle) return Response.json({ success: false, error: { message: 'State could not be saved' } }, { status: 500 });
      skills = skills.map(item => item.sourcePath === body.sourcePath ? { ...item, enabled: body.enabled } : item);
      return Response.json({ success: true });
    }
    if (path.endsWith('/enable')) {
      if (rejectToggle) return Response.json({ success: false, error: { message: 'State could not be saved' } }, { status: 500 });
      const name = decodeURIComponent(path.split('/').at(-2)!);
      if (path.includes('/mcp/')) connectors = connectors.map(item => item.name === name ? { ...item, enabled: body.enabled } : item);
      else plugins = plugins.map(item => item.name === name ? { ...item, enabled: body.enabled } : item);
      return Response.json({ success: true });
    }
    return Response.json({ success: true });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function openPage() {
  const id = String(++fixtureId);
  return render(<PluginsProvider><ExtensionsSettingsPage currentProjects={[{ projectId: id, path: `/fixture/${id}` }]} /></PluginsProvider>);
}

it('groups three extension types in the requested order, hides config details, and filters names and descriptions', async () => {
  openPage();
  await screen.findByRole('article', { name: 'Summary' });
  const enabled = screen.getByRole('region', { name: 'Enabled' });
  expect(within(enabled).getAllByRole('article').map(card => card.dataset.extensionKind)).toEqual(['plugin', 'mcp', 'skill']);
  expect(within(screen.getByRole('region', { name: 'Disabled' })).getAllByRole('article').map(card => card.dataset.extensionKind)).toEqual(['plugin', 'mcp', 'skill']);
  expect(screen.queryByText('claude-usage')).toBeNull();
  expect(screen.queryByText(/secret-argument|private-value|private\/python/)).toBeNull();
  expect(within(screen.getByRole('article', { name: 'windows-pc-files' })).queryByRole('button', { name: 'Open Panel' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  expect(screen.getAllByRole('article').map(card => card.dataset.extensionKind)).toEqual(['mcp', 'mcp']);
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter your extensions' }), { target: { value: 'lengthy conversations' } });
  expect(screen.getAllByRole('article').every(card => card.dataset.extensionKind === 'skill')).toBe(true);
});

it('moves plugins, MCP and skills only after state is saved and retains their disabled state on reopening', async () => {
  const page = openPage();
  await screen.findByRole('article', { name: 'Summary' });
  for (const name of ['Wallpaper', 'windows-pc-files', 'Summary']) {
    fireEvent.click(screen.getByRole('switch', { name: `Enable ${name}` }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Disabled' })).getByRole('article', { name })).toBeTruthy());
  }
  page.unmount(); openPage();
  await waitFor(() => {
    expect(screen.getAllByRole('switch')).toHaveLength(6);
    expect(screen.getAllByRole('switch').every(button => button.getAttribute('aria-checked') === 'false')).toBe(true);
  });
});

it('keeps a card in its original group on a failed toggle and shows the failure', async () => {
  openPage(); await screen.findByRole('article', { name: 'Summary' });
  rejectToggle = true;
  fireEvent.click(screen.getByRole('switch', { name: 'Enable windows-pc-files' }));
  expect(await screen.findByText('State could not be saved')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Enabled' })).getByRole('article', { name: 'windows-pc-files' })).toBeTruthy();
});

it('opens installation with the plus action and returns newly installed plugins to All', async () => {
  openPage(); await screen.findByRole('article', { name: 'Summary' });
  expect(screen.queryByLabelText('Plugin git repository URL')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add extension' }));
  const input = screen.getByLabelText('Plugin git repository URL');
  fireEvent.change(input, { target: { value: 'https://example.test/new-plugin.git' } });
  fireEvent.submit(input.closest('form')!);
  expect(await screen.findByRole('article', { name: 'New Plugin' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
});

it('installs an HTTP connector from a link and refuses to overwrite an explicitly named connector', async () => {
  openPage(); await screen.findByRole('article', { name: 'Summary' });
  fireEvent.click(screen.getByRole('button', { name: 'Connectors' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add extension' }));
  const name = screen.getByRole('textbox', { name: 'Connector name' });
  const address = screen.getByRole('textbox', { name: 'Connector URL' });
  fireEvent.change(name, { target: { value: 'windows-pc-files' } });
  fireEvent.change(address, { target: { value: 'https://docs.example.test/mcp' } });
  fireEvent.submit(address.closest('form')!);
  expect(await screen.findByText('A connector with that name already exists. Choose another name.')).toBeTruthy();
  expect(connectors.find(item => item.name === 'windows-pc-files')?.command).toBe('/private/python');
  fireEvent.change(name, { target: { value: 'New Connector' } });
  fireEvent.submit(address.closest('form')!);
  expect(await screen.findByRole('article', { name: 'New Connector' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
});

it('installs a skill link from the dedicated page and returns it to the enabled list', async () => {
  openPage(); await screen.findByRole('article', { name: 'Summary' });
  fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add extension' }));
  const input = screen.getByRole('textbox', { name: /link/i });
  fireEvent.change(input, { target: { value: 'https://github.com/example/skills/tree/main/summary' } });
  fireEvent.submit(input.closest('form')!);
  expect(await screen.findByRole('article', { name: 'Linked Skill' })).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Enabled' })).getByRole('article', { name: 'Linked Skill' })).toBeTruthy();
});

it('reuses management in the full-size page and filters recommendations alongside installed items', async () => {
  render(<PluginsProvider><PluginsPage currentProjects={[{ projectId: String(++fixtureId), path: '/fixture/full-page' }]} menuButton={<button>Menu</button>} /></PluginsProvider>);
  await screen.findByRole('article', { name: 'Summary' });
  expect(screen.getByTestId('plugins-page')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Menu' })).toBeTruthy();
  const recommendations = screen.getByRole('region', { name: 'Most popular' });
  expect(within(recommendations).getAllByRole('article')).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
  expect(screen.queryByRole('region', { name: 'Most popular' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter your extensions' }), { target: { value: 'Gmail' } });
  expect(within(screen.getByRole('region', { name: 'Most popular' })).getAllByRole('article')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('link', { name: 'Open Claude connectors' }).getAttribute('href')).toBe('https://claude.ai/customize/connectors');
  expect(within(dialog).getByText('/login')).toBeTruthy();
  expect(within(dialog).getByText('/mcp')).toBeTruthy();
  expect(within(dialog).getByText(/API keys/)).toBeTruthy();
  expect(connectors).toHaveLength(2);
});

it('does not show account recommendations inside the compact Settings manager', async () => {
  openPage();
  await screen.findByRole('article', { name: 'Summary' });
  expect(screen.queryByRole('region', { name: 'Most popular' })).toBeNull();
});

it('shows the shared browser indicator only while minimized and restores it from the plugin header', async () => {
  const onOpenBrowser = vi.fn();
  const projects = [{ projectId: String(++fixtureId), path: '/fixture/browser-indicator' }];
  const page = render(<PluginsProvider><PluginsPage currentProjects={projects} browserMinimized onOpenBrowser={onOpenBrowser} /></PluginsProvider>);
  await screen.findByRole('article', { name: 'Summary' });
  const button = screen.getByRole('button', { name: 'Open built-in browser' });
  expect(within(button).getByTestId('browser-running-dot')).toBeTruthy();
  fireEvent.click(button);
  expect(onOpenBrowser).toHaveBeenCalledTimes(1);
  page.rerender(<PluginsProvider><PluginsPage currentProjects={projects} browserMinimized={false} onOpenBrowser={onOpenBrowser} /></PluginsProvider>);
  expect(screen.queryByTestId('browser-running-dot')).toBeNull();
});

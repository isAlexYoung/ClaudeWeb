import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { i18n } from '@/modules/i18n';
import { PluginsProvider } from '@/modules/plugins';
import PluginsSettingsTab from '@/modules/settings/tabs/PluginsSettingsTab';

afterEach(() => vi.unstubAllGlobals());

it('one refresh action reloads all lists and remains disabled until every request settles', async () => {
  await i18n.changeLanguage('en');
  const calls = { plugins: 0, mcp: 0, skills: 0 };
  let holdMcp = false;
  let finish!: () => void;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/plugins') { calls.plugins++; return Response.json({ plugins: [] }); }
    if (url.includes('/mcp/servers')) {
      calls.mcp++;
      if (holdMcp) await new Promise<void>(resolve => { finish = resolve; });
      return Response.json({ success: true, data: { servers: [] } });
    }
    if (url.includes('/skills')) { calls.skills++; return Response.json({ success: true, data: { skills: [] } }); }
    return Response.json({ success: true });
  }));
  render(<PluginsProvider><PluginsSettingsTab projects={[]} /></PluginsProvider>);
  await waitFor(() => expect(calls).toEqual({ plugins: 1, mcp: 1, skills: 1 }));
  holdMcp = true;
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  fireEvent.click(refresh);
  expect(calls).toEqual({ plugins: 2, mcp: 2, skills: 2 });
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  finish();
  await waitFor(() => expect((refresh as HTMLButtonElement).disabled).toBe(false));
});

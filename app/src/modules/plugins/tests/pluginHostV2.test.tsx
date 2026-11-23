import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import '@/modules/i18n';
import { PluginsProvider, usePlugins } from '@/modules/plugins/context/PluginsContext';
import PluginSettingsTab from '@/modules/plugins/PluginSettingsTab';
import PublicLoginAppearance from '@/modules/plugins/PublicLoginAppearance';
import {
  applyWallpaperSurfaceVars,
  createPluginEventBus,
  createPluginStyleManager,
  purgePluginStyles,
} from '@/modules/plugins/pluginRuntime';
import type { Plugin, PluginHostEvent, PublicAppearanceState } from '@/shared/types';

const wallpaperPluginA: Plugin = {
  name: 'wallpaper-a',
  displayName: 'Wallpaper A',
  version: '1.0.0',
  description: 'Static & animated wallpapers',
  author: 'isAlexYoung',
  icon: '',
  type: 'module',
  slot: 'background',
  slots: ['background', 'settings'],
  panel: { title: 'Wallpaper Settings', mode: 'drawer', width: 440 },
  publicAppearance: true,
  compatible: true,
  entry: 'dist/index.js',
  server: 'dist/server.cjs',
  permissions: ['media'],
  enabled: true,
  serverRunning: true,
  dirName: 'wallpaper-a',
  repoUrl: 'https://github.com/isAlexYoung/claudeweb-wallpaper',
};

const wallpaperPluginB: Plugin = {
  ...wallpaperPluginA,
  name: 'wallpaper-b',
  displayName: 'Wallpaper B',
  enabled: false,
  serverRunning: false,
  dirName: 'wallpaper-b',
};

function PanelProbe() {
  const { openPanelPlugin } = usePlugins();
  return <div data-testid="open-panel-name">{openPanelPlugin ?? 'none'}</div>;
}

describe('Plugin Host v2 frontend runtime & UI', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.dataset.theme = 'warm';
    applyWallpaperSurfaceVars(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    applyWallpaperSurfaceVars(null);
    delete document.documentElement.dataset.cwLoginWallpaper;
  });

  it('normalizes WebSocket events with turnId/runId, ignores suggestion statuses, and reconciles chat_subscribed', () => {
    const bus = createPluginEventBus();
    const seen: PluginHostEvent[] = [];
    bus.on('agent:state', (ev) => seen.push(ev));
    bus.on('chat:turn-finished', (ev) => seen.push(ev));

    // Suggestion status must NOT kick off an active thinking run
    bus.ingestServerEvent({ kind: 'status', sessionId: 's1', text: 'prompt_suggestion' }, 's1');
    expect(bus.getSnapshot().activeRuns).toHaveLength(0);

    // Real thinking -> tool_use -> waiting_approval -> cancelled flow
    bus.ingestServerEvent({ kind: 'thinking', sessionId: 's1', runId: 'r1', turnId: 't1' }, 's1');
    bus.ingestServerEvent({ kind: 'tool_use', sessionId: 's1', toolName: 'Bash' }, 's1');
    bus.ingestServerEvent({ kind: 'permission_request', sessionId: 's1', toolName: 'Bash' }, 's1');
    expect(bus.getSnapshot().activeRuns[0]?.state).toBe('waiting_approval');
    expect(bus.getSnapshot().activeRuns[0]?.turnId).toBe('t1');

    bus.ingestServerEvent({ kind: 'complete', sessionId: 's1', aborted: true }, 's1');
    expect(bus.getSnapshot().activeRuns).toHaveLength(0);
    expect(seen.some((e) => e.type === 'chat:turn-finished' && e.outcome === 'cancelled')).toBe(true);

    // Reconnect reconciliation: chat_subscribed with isProcessing: false clears stale active run
    bus.ingestServerEvent({ kind: 'stream_delta', sessionId: 's2', content: 'hi' }, 's2');
    expect(bus.getSnapshot().activeRuns).toHaveLength(1);
    bus.ingestServerEvent({ kind: 'chat_subscribed', sessionId: 's2', isProcessing: false }, 's2');
    expect(bus.getSnapshot().activeRuns).toHaveLength(0);
  });

  it('applies & clears wallpaper surface vars and managed styles cleanly', () => {
    applyWallpaperSurfaceVars({ scope: 'workspace', surfaceOpacity: 0.78, glassBlurPx: 18 });
    expect(document.documentElement.dataset.cwWallpaper).toBe('workspace');
    expect(document.documentElement.style.getPropertyValue('--cw-surface-opacity')).toBe('0.78');
    expect(document.documentElement.style.getPropertyValue('--cw-glass-blur')).toBe('18px');

    applyWallpaperSurfaceVars(null);
    expect(document.documentElement.dataset.cwWallpaper).toBeUndefined();

    const styles = createPluginStyleManager('demo-plugin');
    styles.set('main', '.demo { color: red; }');
    expect(document.querySelectorAll('style[data-cw-plugin="demo-plugin"]')).toHaveLength(1);
    purgePluginStyles('demo-plugin');
    expect(document.querySelectorAll('style[data-cw-plugin="demo-plugin"]')).toHaveLength(0);
  });

  it('opens the settings drawer and handles background slot 409 conflict confirmation', async () => {
    let activeBg = 'wallpaper-a';
    let bEnabled = false;

    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/plugins') {
        return new Response(
          JSON.stringify({
            plugins: [wallpaperPluginA, { ...wallpaperPluginB, enabled: bEnabled }],
            host: { version: '2.1.5', apiVersion: 2, capabilities: ['slots:background'], activeBackgroundPlugin: activeBg },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/plugins/wallpaper-b/enable') {
        const body = JSON.parse(String(options?.body));
        if (body.enabled && !body.takeoverBackground) {
          return new Response(
            JSON.stringify({
              success: false,
              error: {
                code: 'BACKGROUND_SLOT_OCCUPIED',
                message: 'Background slot is currently active for "wallpaper-a"',
                details: { activePlugin: 'wallpaper-a' },
              },
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
        bEnabled = Boolean(body.enabled);
        activeBg = 'wallpaper-b';
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    vi.stubGlobal('fetch', fetchMock);
    render(
      <PluginsProvider>
        <PluginSettingsTab />
        <PanelProbe />
      </PluginsProvider>,
    );

    const openButtons = await screen.findAllByRole('button', { name: 'Open Panel' });
    fireEvent.click(openButtons[0]);
    expect(screen.getByTestId('open-panel-name').textContent).toBe('wallpaper-a');

    // Enabling second background plugin shows inline conflict prompt, then succeeds with takeoverBackground
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Wallpaper B' }));
    const switchBtn = await screen.findByRole('button', { name: 'Switch background' });
    fireEvent.click(switchBtn);

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'Disable Wallpaper B' })).toBeTruthy();
    });
  });

  it('PublicLoginAppearance renders per-theme wallpaper and clears local mirror when server disables it', async () => {
    const enabledState: PublicAppearanceState = {
      schema: 1,
      enabled: true,
      revision: 'rev-1',
      mode: 'per-theme',
      slots: {
        warm: {
          mediaType: 'gradient',
          cssGradient: 'linear-gradient(135deg, #f5e6d3 0%, #e8d5c4 100%)',
          fit: 'cover',
          positionX: 50,
          positionY: 50,
          blurPx: 0,
          scrimOpacity: 0.1,
          scrimMode: 'auto',
          cardOpacity: 0.88,
        },
      },
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(enabledState), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const { unmount } = render(<PublicLoginAppearance />);
    expect(await screen.findByTestId('public-login-appearance')).toBeTruthy();
    expect(document.documentElement.dataset.cwLoginWallpaper).toBe('1');
    expect(localStorage.getItem('appearance-login-wallpaper')).toContain('rev-1');
    unmount();

    // Now server returns enabled: false -> must remove rendered layer & clear localStorage mirror
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ schema: 1, enabled: false, revision: '', mode: 'single', slots: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )));

    render(<PublicLoginAppearance />);
    await waitFor(() => {
      expect(screen.queryByTestId('public-login-appearance')).toBeNull();
      expect(localStorage.getItem('appearance-login-wallpaper')).toBeNull();
    });
  });
});

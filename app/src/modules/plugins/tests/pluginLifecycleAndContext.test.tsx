import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n';
import GlobalPluginsRunner from '@/modules/plugins/GlobalPluginsRunner';
import PluginSettingsPanel from '@/modules/plugins/PluginSettingsPanel';
import PluginTabContent from '@/modules/plugins/PluginTabContent';
import { PluginsProvider, usePlugins } from '@/modules/plugins/context/PluginsContext';
import { evictPluginModuleCache } from '@/modules/plugins/pluginRuntime';
import type { Plugin, PluginHostContext, PluginHostEvent, ServerEvent } from '@/shared/types';

const wsListeners = new Set<(event: ServerEvent) => void>();

vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    themeMode: 'warm' as const,
    setThemeMode: vi.fn(),
  }),
}));

vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    ws: null,
    sendMessage: vi.fn(),
    isConnected: true,
    connectionStatus: 'connected' as const,
    subscribe: (listener: (event: ServerEvent) => void) => {
      wsListeners.add(listener);
      return () => {
        wsListeners.delete(listener);
      };
    },
  }),
}));

type RecordedPluginMetrics = {
  activateCalls: number;
  deactivateCalls: number;
  mountLayerCalls: string[];
  unmountLayerCalls: string[];
  mountSettingsCalls: number;
  unmountSettingsCalls: number;
  mountTabCalls: number;
  unmountTabCalls: number;
  contexts: PluginHostContext[];
  agentEvents: PluginHostEvent[];
  activationHadSurface: boolean;
};

const metricsRegistry = new Map<string, RecordedPluginMetrics>();

function ensureMetrics(name: string): RecordedPluginMetrics {
  let m = metricsRegistry.get(name);
  if (!m) {
    m = {
      activateCalls: 0,
      deactivateCalls: 0,
      mountLayerCalls: [],
      unmountLayerCalls: [],
      mountSettingsCalls: 0,
      unmountSettingsCalls: 0,
      mountTabCalls: 0,
      unmountTabCalls: 0,
      contexts: [],
      agentEvents: [],
      activationHadSurface: false,
    };
    metricsRegistry.set(name, m);
  }
  return m;
}

function buildTestPluginModuleSource(name: string): string {
  return `
    const metrics = globalThis.__cwPluginTestMetrics(${JSON.stringify(name)});
    export function activate(host) {
      metrics.activateCalls += 1;
      metrics.activationHadSurface = Boolean(host.surface);
      metrics.contexts.push(host.context);
      host.onContextChange((ctx) => metrics.contexts.push(ctx));
      host.events.on('agent:state', (ev) => metrics.agentEvents.push(ev));
    }
    export function deactivate() {
      metrics.deactivateCalls += 1;
    }
    export function mountLayer(slot, container) {
      metrics.mountLayerCalls.push(slot);
      const el = document.createElement('div');
      el.dataset.testSlot = slot;
      container.appendChild(el);
    }
    export function unmountLayer(slot) {
      metrics.unmountLayerCalls.push(slot);
    }
    export function mountSettings(container) {
      metrics.mountSettingsCalls += 1;
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'settings-input-' + ${JSON.stringify(name)});
      container.appendChild(input);
    }
    export function unmountSettings() {
      metrics.unmountSettingsCalls += 1;
    }
    export function mount(container) {
      metrics.mountTabCalls += 1;
      const input = document.createElement('input');
      input.setAttribute('data-testid', 'tab-input-' + ${JSON.stringify(name)});
      container.appendChild(input);
    }
    export function unmount() {
      metrics.unmountTabCalls += 1;
    }
  `;
}

function makePlugin(overrides: Partial<Plugin> & { name: string }): Plugin {
  return {
    displayName: overrides.name,
    version: '1.0.0',
    description: 'Test plugin',
    author: 'tester',
    icon: '',
    type: 'module',
    slot: 'tab',
    slots: ['tab'],
    compatible: true,
    entry: 'dist/index.js',
    server: null,
    permissions: [],
    enabled: true,
    serverRunning: false,
    dirName: overrides.name,
    repoUrl: null,
    ...overrides,
  };
}

function ContextController({
  onReady,
}: {
  onReady: (api: {
    refreshPlugins: () => Promise<void>;
    openPluginPanel: (name: string) => void;
    closePluginPanel: (force?: boolean) => void;
    setWorkspaceContext: ReturnType<typeof usePlugins>['setWorkspaceContext'];
  }) => void;
}) {
  const { refreshPlugins, openPluginPanel, closePluginPanel, setWorkspaceContext } = usePlugins();
  onReady({ refreshPlugins, openPluginPanel, closePluginPanel, setWorkspaceContext });
  return null;
}

describe('Plugin Host v2 unified lifecycle, live workspace context & stable remounts', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    wsListeners.clear();
    metricsRegistry.clear();
    evictPluginModuleCache();
    (globalThis as unknown as { __cwPluginTestMetrics?: typeof ensureMetrics }).__cwPluginTestMetrics = ensureMetrics;

    // Map Blob ESM sources to Node-importable data: URLs so real importPluginModule() executes in Vitest.
    const blobSourceMap = new WeakMap<Blob, string>();
    const OriginalBlob = globalThis.Blob;
    class TrackingBlob extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        blobSourceMap.set(this, (parts ?? []).map((p) => String(p)).join(''));
      }
    }
    vi.stubGlobal('Blob', TrackingBlob);
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const source = blobSourceMap.get(blob) ?? '';
      return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
    });
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    delete (globalThis as unknown as { __cwPluginTestMetrics?: typeof ensureMetrics }).__cwPluginTestMetrics;
    vi.unstubAllGlobals();
    evictPluginModuleCache();
  });

  function stubPluginFetch(getPlugins: () => Plugin[], activeBackgroundPlugin: string | null = null) {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/plugins') {
        // Return fresh cloned objects every call to simulate real JSON deserialization on refreshPlugins().
        const cloned = getPlugins().map((p) => ({ ...p, slots: p.slots ? [...p.slots] : undefined }));
        return new Response(
          JSON.stringify({
            plugins: cloned,
            host: {
              version: '2.2.1',
              apiVersion: 2,
              capabilities: ['slots:tab', 'slots:background', 'slots:overlay', 'slots:settings'],
              activeBackgroundPlugin,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const assetMatch = url.match(/^\/api\/plugins\/([^/]+)\/assets\/(.+)$/);
      if (assetMatch) {
        const pluginName = decodeURIComponent(assetMatch[1]);
        return new Response(buildTestPluginModuleSource(pluginName), {
          status: 200,
          headers: { 'Content-Type': 'application/javascript' },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
  }

  it('activates a multi-slot (background + overlay) plugin once, propagates live project/session & isFocusedSession, and deactivates once', async () => {
    const dualPlugin = makePlugin({
      name: 'dual-widget',
      slot: 'background',
      slots: ['background', 'overlay'],
    });
    stubPluginFetch(() => [dualPlugin], 'dual-widget');

    let controls: Parameters<Parameters<typeof ContextController>[0]['onReady']>[0] | null = null;

    const { unmount } = render(
      <PluginsProvider>
        <ContextController onReady={(api) => { controls = api; }} />
        <GlobalPluginsRunner />
      </PluginsProvider>,
    );

    await waitFor(() => {
      const m = metricsRegistry.get('dual-widget');
      expect(m?.mountLayerCalls).toContain('background');
      expect(m?.mountLayerCalls).toContain('overlay');
    });

    const m = ensureMetrics('dual-widget');
    expect(m.activateCalls).toBe(1);
    expect(m.activationHadSurface).toBe(true);
    expect(m.deactivateCalls).toBe(0);

    // Update live workspace project & session and verify global plugin receives it.
    act(() => {
      controls?.setWorkspaceContext({
        route: 'workspace',
        project: { name: 'proj-alpha', path: '/srv/alpha' },
        session: { id: 'sess-active', title: 'Alpha Chat' },
      });
    });

    await waitFor(() => {
      expect(m.contexts.some((c) => c.project?.name === 'proj-alpha' && c.session?.id === 'sess-active')).toBe(true);
    });

    // Emit WS frames for focused session and another session -> verify isFocusedSession flag!
    act(() => {
      for (const listener of wsListeners) {
        listener({ kind: 'thinking', sessionId: 'sess-active', runId: 'run-1', turnId: 'turn-1' });
        listener({ kind: 'thinking', sessionId: 'sess-other', runId: 'run-2', turnId: 'turn-2' });
      }
    });

    const focusedEv = m.agentEvents.find(
      (ev) => ev.type === 'agent:state' && ev.sessionId === 'sess-active',
    );
    const otherEv = m.agentEvents.find(
      (ev) => ev.type === 'agent:state' && ev.sessionId === 'sess-other',
    );
    expect(focusedEv && focusedEv.type === 'agent:state' && focusedEv.isFocusedSession).toBe(true);
    expect(otherEv && otherEv.type === 'agent:state' && otherEv.isFocusedSession).toBe(false);

    unmount();
    expect(m.deactivateCalls).toBe(1);
  });

  it('activates settings-only and tab-only plugins once and does NOT remount them on refreshPlugins()', async () => {
    const settingsOnly = makePlugin({
      name: 'settings-only',
      slot: 'settings',
      slots: ['settings'],
      panel: { title: 'Only Settings', mode: 'drawer', width: 400 },
    });
    const tabOnly = makePlugin({
      name: 'tab-only',
      slot: 'tab',
      slots: ['tab'],
    });
    stubPluginFetch(() => [settingsOnly, tabOnly], null);

    let controls: Parameters<Parameters<typeof ContextController>[0]['onReady']>[0] | null = null;

    const { unmount } = render(
      <PluginsProvider>
        <ContextController onReady={(api) => { controls = api; }} />
        <PluginSettingsPanel />
        <PluginTabContent pluginName="tab-only" selectedProject={null} selectedSession={null} />
      </PluginsProvider>,
    );

    await waitFor(() => {
      expect(metricsRegistry.get('tab-only')?.mountTabCalls).toBe(1);
    });
    expect(ensureMetrics('tab-only').activateCalls).toBe(1);

    // Open the settings-only drawer -> activate() must run once for it too.
    act(() => {
      controls?.openPluginPanel('settings-only');
    });

    await waitFor(() => {
      expect(metricsRegistry.get('settings-only')?.mountSettingsCalls).toBe(1);
    });
    expect(ensureMetrics('settings-only').activateCalls).toBe(1);

    // Refresh plugin list (returns fresh cloned Plugin objects with unchanged version/entry/enabled).
    await act(async () => {
      await controls?.refreshPlugins();
      await controls?.refreshPlugins();
    });

    // Neither the open tab nor the open settings drawer may unmount or remount!
    expect(ensureMetrics('tab-only').mountTabCalls).toBe(1);
    expect(ensureMetrics('tab-only').unmountTabCalls).toBe(0);
    expect(ensureMetrics('settings-only').mountSettingsCalls).toBe(1);
    expect(ensureMetrics('settings-only').unmountSettingsCalls).toBe(0);

    // Closing the settings drawer unmounts settings and deactivates the settings-only plugin once.
    act(() => {
      controls?.closePluginPanel(true);
    });
    await waitFor(() => {
      expect(ensureMetrics('settings-only').unmountSettingsCalls).toBe(1);
      expect(ensureMetrics('settings-only').deactivateCalls).toBe(1);
    });

    // Unmounting tab-only deactivates it once.
    unmount();
    expect(ensureMetrics('tab-only').unmountTabCalls).toBe(1);
    expect(ensureMetrics('tab-only').deactivateCalls).toBe(1);
  });
});

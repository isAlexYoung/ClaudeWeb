import { AppError } from '@/shared/utils.js';

import {
  HOST_CAPABILITIES,
  PLUGIN_API_VERSION,
  type PublicAppearanceState,
} from './plugin-contract.js';

type PluginManifest = Record<string, unknown> & {
  name: string;
  dirName?: string;
  enabled?: boolean;
  server?: unknown;
  slots?: string[];
  slot?: string;
  compatible?: boolean;
  incompatibilityReason?: string | null;
  publicAppearance?: boolean;
};

type HostPluginConfig = {
  activeBackgroundPlugin?: string | null;
  overlayOrder?: string[];
};

type PluginConfigEntry = {
  enabled?: boolean;
  secrets?: Record<string, unknown>;
};

type PluginConfig = Record<string, PluginConfigEntry | HostPluginConfig | undefined> & {
  _host?: HostPluginConfig;
};

type PluginProcessState = {
  running: boolean;
  lastError: string | null;
  circuitOpen: boolean;
};

type PluginDependencies = {
  scanPlugins(): PluginManifest[];
  readConfig(): PluginConfig;
  saveConfig(config: PluginConfig): void;
  getPluginDirectory(pluginName: string): string | null;
  /** Reviewed local-history implementation, independent of user-installed plugin versions. */
  getBundledUsageDirectory?(): string | null;
  resolveAsset(pluginName: string, assetPath: string): string | null;
  assetIsFile(assetPath: string): boolean;
  contentType(assetPath: string): string;
  install(url: string): Promise<unknown>;
  update(pluginName: string): Promise<unknown>;
  uninstall(pluginName: string, options?: { removeData?: boolean }): Promise<unknown>;
  startServer(pluginName: string, pluginDirectory: string, serverConfig: unknown): Promise<number>;
  stopServer(pluginName: string): Promise<void>;
  getServerPort(pluginName: string): number | undefined;
  isServerRunning(pluginName: string): boolean;
  getProcessState?(pluginName: string): PluginProcessState;
  resetCircuit?(pluginName: string): void;
  getHostVersion?(): string;
  createMediaTicket?(input: { pluginName: string; path: unknown; sessionId: string; ttlMs?: unknown }): {
    ticketId: string;
    url: string;
    expiresAt: number;
  };
  resolveMediaTicket?(pluginName: string, ticketId: string): { normalizedPath: string; sessionId: string } | null;
  revokeMediaTickets?(pluginName: string): number;
  storePublicAppearanceMedia?(buffer: Buffer): { hash: string; mimeType: string; bytes: number };
  publishPublicAppearance?(pluginName: string, payload: unknown): PublicAppearanceState;
  clearPublicAppearance?(pluginName?: string): boolean;
  logError(message: string, error: unknown): void;
};

function validatePluginName(pluginName: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
    throw new AppError('Invalid plugin name', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
  }
}

function normalizePluginManifest(value: unknown): PluginManifest {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('Plugin manifest is invalid', {
      code: 'INVALID_PLUGIN_MANIFEST',
      statusCode: 400,
    });
  }
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.name !== 'string') {
    throw new AppError('Plugin manifest is missing its name', {
      code: 'INVALID_PLUGIN_MANIFEST',
      statusCode: 400,
    });
  }
  return manifest as PluginManifest;
}

function slotsOf(plugin: PluginManifest): string[] {
  if (Array.isArray(plugin.slots) && plugin.slots.length > 0) return plugin.slots;
  return [typeof plugin.slot === 'string' && plugin.slot ? plugin.slot : 'tab'];
}

function readEntry(config: PluginConfig, name: string): PluginConfigEntry {
  const raw = config[name];
  if (raw && typeof raw === 'object' && name !== '_host') {
    return raw as PluginConfigEntry;
  }
  return {};
}

function ensureHostSection(config: PluginConfig): HostPluginConfig {
  if (!config._host || typeof config._host !== 'object') {
    config._host = { activeBackgroundPlugin: null, overlayOrder: [] };
  }
  if (!Array.isArray(config._host.overlayOrder)) {
    config._host.overlayOrder = [];
  }
  return config._host;
}

/** Creates plugin-management workflows around loader, process, media-ticket and public-appearance adapters. */
export function createPluginsService(dependencies: PluginDependencies) {
  async function startServerIfAvailable(plugin: PluginManifest): Promise<void> {
    if (!plugin.server || plugin.compatible === false || dependencies.isServerRunning(plugin.name)) return;
    const pluginDirectory = dependencies.getPluginDirectory(plugin.name);
    if (!pluginDirectory) return;
    try {
      await dependencies.startServer(plugin.name, pluginDirectory, plugin.server);
    } catch (error) {
      dependencies.logError(`Failed to start plugin server for ${plugin.name}`, error);
    }
  }

  function findActiveBackgroundOwner(plugins: PluginManifest[], config: PluginConfig): string | null {
    const candidate = typeof config._host?.activeBackgroundPlugin === 'string'
      ? config._host.activeBackgroundPlugin
      : null;
    if (!candidate) return null;
    const match = plugins.find((p) => p.name === candidate);
    if (!match || !match.enabled || !slotsOf(match).includes('background')) return null;
    return candidate;
  }

  function requirePublicAppearancePlugin(pluginName: string): PluginManifest {
    validatePluginName(pluginName);
    const plugins = dependencies.scanPlugins();
    const plugin = plugins.find((candidate) => candidate.name === pluginName);
    if (!plugin) throw new AppError('Plugin not found', { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });
    if (!plugin.enabled) throw new AppError('Plugin is disabled', { code: 'PLUGIN_DISABLED', statusCode: 403 });
    if (plugin.publicAppearance !== true) {
      throw new AppError('Plugin does not declare publicAppearance capability in manifest.json', {
        code: 'PUBLIC_APPEARANCE_NOT_DECLARED',
        statusCode: 403,
      });
    }
    const config = dependencies.readConfig();
    if (slotsOf(plugin).includes('background')) {
      const activeOwner = findActiveBackgroundOwner(plugins, config);
      if (activeOwner && activeOwner !== pluginName) {
        throw new AppError('Only the active background plugin may update login appearance', {
          code: 'BACKGROUND_SLOT_NOT_ACTIVE',
          statusCode: 409,
        });
      }
    }
    return plugin;
  }

  return {
    list() {
      const plugins = dependencies.scanPlugins();
      const config = dependencies.readConfig();
      const activeBackgroundPlugin = findActiveBackgroundOwner(plugins, config);
      return {
        plugins: plugins.map((plugin) => {
          const proc = dependencies.getProcessState?.(plugin.name);
          const serverRunning = plugin.server ? dependencies.isServerRunning(plugin.name) : false;
          return {
            ...plugin,
            activeBackground: plugin.enabled === true && slotsOf(plugin).includes('background') && activeBackgroundPlugin === plugin.name,
            serverRunning,
            serverError: proc?.lastError ?? null,
            serverCircuitOpen: proc?.circuitOpen ?? false,
          };
        }),
        host: {
          version: dependencies.getHostVersion?.() ?? '0.0.0',
          apiVersion: PLUGIN_API_VERSION,
          capabilities: [...HOST_CAPABILITIES],
          activeBackgroundPlugin,
        },
      };
    },

    getManifest(pluginName: string) {
      validatePluginName(pluginName);
      const plugin = dependencies.scanPlugins().find((candidate) => candidate.name === pluginName);
      if (!plugin) throw new AppError('Plugin not found', { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });
      return plugin;
    },

    resolveAsset(pluginName: string, assetPath: string) {
      validatePluginName(pluginName);
      if (!assetPath) throw new AppError('No asset path specified', { code: 'PLUGIN_ASSET_REQUIRED', statusCode: 400 });
      const resolvedPath = dependencies.resolveAsset(pluginName, assetPath);
      if (!resolvedPath || !dependencies.assetIsFile(resolvedPath)) {
        throw new AppError('Asset not found', { code: 'PLUGIN_ASSET_NOT_FOUND', statusCode: 404 });
      }
      return { path: resolvedPath, contentType: dependencies.contentType(resolvedPath) };
    },

    async setEnabled(pluginName: string, enabled: unknown, options: { takeoverBackground?: boolean } = {}) {
      validatePluginName(pluginName);
      if (typeof enabled !== 'boolean') {
        throw new AppError('"enabled" must be a boolean', { code: 'INVALID_PLUGIN_ENABLED', statusCode: 400 });
      }
      const plugins = dependencies.scanPlugins();
      const plugin = plugins.find((candidate) => candidate.name === pluginName);
      if (!plugin) throw new AppError('Plugin not found', { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });

      if (enabled && plugin.compatible === false) {
        throw new AppError(plugin.incompatibilityReason || 'Plugin is incompatible with this ClaudeWeb version', {
          code: 'PLUGIN_INCOMPATIBLE',
          statusCode: 422,
        });
      }

      const config = dependencies.readConfig();
      const hostConfig = ensureHostSection(config);
      const slots = slotsOf(plugin);

      if (enabled && slots.includes('background')) {
        const currentOwner = findActiveBackgroundOwner(plugins, config);
        if (currentOwner && currentOwner !== pluginName) {
          if (options.takeoverBackground !== true) {
            throw new AppError(`Background slot is currently active for "${currentOwner}"`, {
              code: 'BACKGROUND_SLOT_OCCUPIED',
              statusCode: 409,
              details: { activePlugin: currentOwner },
            });
          }
          dependencies.clearPublicAppearance?.(currentOwner);
          hostConfig.activeBackgroundPlugin = pluginName;
        } else {
          hostConfig.activeBackgroundPlugin = pluginName;
        }
      }

      if (enabled && slots.includes('overlay') && !hostConfig.overlayOrder!.includes(pluginName)) {
        hostConfig.overlayOrder!.push(pluginName);
      }

      if (!enabled) {
        if (hostConfig.activeBackgroundPlugin === pluginName) {
          hostConfig.activeBackgroundPlugin = null;
        }
        dependencies.revokeMediaTickets?.(pluginName);
        dependencies.clearPublicAppearance?.(pluginName);
      }

      config[pluginName] = { ...readEntry(config, pluginName), enabled };
      dependencies.saveConfig(config);

      if (enabled) {
        dependencies.resetCircuit?.(pluginName);
      }
      if (plugin.server && enabled) await startServerIfAvailable(plugin);
      if (plugin.server && !enabled && dependencies.isServerRunning(pluginName)) {
        await dependencies.stopServer(pluginName);
      }
      return {
        success: true,
        name: pluginName,
        enabled,
        activeBackgroundPlugin: hostConfig.activeBackgroundPlugin ?? null,
      };
    },

    setActiveBackground(pluginName: unknown) {
      if (pluginName !== null && typeof pluginName !== 'string') {
        throw new AppError('"name" must be a plugin name or null', { code: 'INVALID_PLUGIN_NAME', statusCode: 400 });
      }
      const plugins = dependencies.scanPlugins();
      const config = dependencies.readConfig();
      const hostConfig = ensureHostSection(config);
      const previous = hostConfig.activeBackgroundPlugin ?? null;

      if (pluginName === null) {
        hostConfig.activeBackgroundPlugin = null;
        if (previous) dependencies.clearPublicAppearance?.(previous);
        dependencies.saveConfig(config);
        return { success: true, activeBackgroundPlugin: null };
      }

      validatePluginName(pluginName);
      const plugin = plugins.find((candidate) => candidate.name === pluginName);
      if (!plugin) throw new AppError('Plugin not found', { code: 'PLUGIN_NOT_FOUND', statusCode: 404 });
      if (!slotsOf(plugin).includes('background')) {
        throw new AppError('Plugin does not declare the background slot', {
          code: 'INVALID_PLUGIN_SLOT',
          statusCode: 400,
        });
      }
      if (!plugin.enabled) {
        throw new AppError('Enable the plugin before activating its background slot', {
          code: 'PLUGIN_DISABLED',
          statusCode: 409,
        });
      }
      if (previous && previous !== pluginName) {
        dependencies.clearPublicAppearance?.(previous);
      }
      hostConfig.activeBackgroundPlugin = pluginName;
      dependencies.saveConfig(config);
      return { success: true, activeBackgroundPlugin: pluginName };
    },

    async install(urlInput: unknown) {
      const url = typeof urlInput === 'string' ? urlInput.trim() : '';
      if (!url || (!url.startsWith('https://') && !url.startsWith('git@'))) {
        throw new AppError('URL must start with https:// or git@', { code: 'INVALID_PLUGIN_URL', statusCode: 400 });
      }
      const plugin = normalizePluginManifest(await dependencies.install(url));
      const plugins = dependencies.scanPlugins();
      const config = dependencies.readConfig();
      const hostConfig = ensureHostSection(config);
      const slots = slotsOf(plugin);
      let configChanged = false;

      if (slots.includes('background') && !findActiveBackgroundOwner(plugins, config)) {
        hostConfig.activeBackgroundPlugin = plugin.name;
        configChanged = true;
      }
      if (slots.includes('overlay') && !hostConfig.overlayOrder!.includes(plugin.name)) {
        hostConfig.overlayOrder!.push(plugin.name);
        configChanged = true;
      }
      if (configChanged) {
        dependencies.saveConfig(config);
      }

      await startServerIfAvailable(plugin);
      return { success: true, plugin };
    },

    async update(pluginName: string) {
      validatePluginName(pluginName);
      const wasRunning = dependencies.isServerRunning(pluginName);
      dependencies.revokeMediaTickets?.(pluginName);
      if (wasRunning) await dependencies.stopServer(pluginName);
      let updatedManifest: unknown;
      try {
        updatedManifest = await dependencies.update(pluginName);
      } catch (error) {
        // A failed update must not leave the plugin's server stopped. It is
        // restarted from the untouched previous version on disk.
        if (wasRunning) {
          const previousPlugin = dependencies.scanPlugins().find((candidate) => candidate.name === pluginName);
          if (previousPlugin) await startServerIfAvailable(previousPlugin);
        }
        throw error;
      }
      const plugin = normalizePluginManifest(updatedManifest);
      dependencies.resetCircuit?.(pluginName);
      if (wasRunning) await startServerIfAvailable(plugin);
      return { success: true, plugin };
    },

    async restart(pluginName: string) {
      validatePluginName(pluginName);
      const plugin = this.getManifest(pluginName);
      if (!plugin.server) {
        throw new AppError('Plugin has no backend server', { code: 'PLUGIN_SERVER_UNAVAILABLE', statusCode: 400 });
      }
      if (!plugin.enabled) {
        throw new AppError('Plugin is disabled', { code: 'PLUGIN_DISABLED', statusCode: 409 });
      }
      dependencies.revokeMediaTickets?.(pluginName);
      dependencies.resetCircuit?.(pluginName);
      if (dependencies.isServerRunning(pluginName)) {
        await dependencies.stopServer(pluginName);
      }
      await startServerIfAvailable(plugin);
      return { success: true, running: dependencies.isServerRunning(pluginName) };
    },

    async prepareRpc(pluginName: string) {
      validatePluginName(pluginName);
      let port = dependencies.getServerPort(pluginName);
      if (!port) {
        const plugin = this.getManifest(pluginName);
        if (!plugin.server) throw new AppError('Plugin server is not running', { code: 'PLUGIN_SERVER_UNAVAILABLE', statusCode: 503 });
        if (plugin.compatible === false) throw new AppError('Plugin is incompatible with this ClaudeWeb host', { code: 'PLUGIN_INCOMPATIBLE', statusCode: 422 });
        if (!plugin.enabled) throw new AppError('Plugin is disabled', { code: 'PLUGIN_DISABLED', statusCode: 503 });
        // Bundled plugins live outside the user's plugin directory. Resolve the same
        // discovered installation used at boot, including after a subprocess exits.
        const pluginDirectory = dependencies.getPluginDirectory(pluginName);
        if (!pluginDirectory) throw new AppError('Plugin directory is unavailable', { code: 'PLUGIN_DIRECTORY_UNAVAILABLE', statusCode: 503 });
        port = await dependencies.startServer(pluginName, pluginDirectory, plugin.server);
      }
      const secrets = readEntry(dependencies.readConfig(), pluginName).secrets ?? {};
      return { port, secrets };
    },

    async createMediaTicket(pluginName: string, pathInput: unknown, sessionId: string, ttlMs?: unknown) {
      validatePluginName(pluginName);
      if (!dependencies.createMediaTicket) {
        throw new AppError('Media tickets are unavailable', { code: 'MEDIA_TICKET_UNAVAILABLE', statusCode: 503 });
      }
      // Ensure the plugin exists, is enabled, and has a backend server ready.
      await this.prepareRpc(pluginName);
      return dependencies.createMediaTicket({ pluginName, path: pathInput, sessionId, ttlMs });
    },

    async prepareMediaRequest(pluginName: string, ticketId: string) {
      validatePluginName(pluginName);
      if (!dependencies.resolveMediaTicket) {
        throw new AppError('Media tickets are unavailable', { code: 'MEDIA_TICKET_UNAVAILABLE', statusCode: 503 });
      }
      const ticket = dependencies.resolveMediaTicket(pluginName, ticketId);
      if (!ticket) {
        throw new AppError('Media ticket expired or invalid', { code: 'MEDIA_TICKET_INVALID', statusCode: 401 });
      }
      const { port, secrets } = await this.prepareRpc(pluginName);
      return { port, secrets, normalizedPath: ticket.normalizedPath };
    },

    storePublicAppearanceMedia(pluginName: string, buffer: Buffer) {
      requirePublicAppearancePlugin(pluginName);
      if (!dependencies.storePublicAppearanceMedia) {
        throw new AppError('Public appearance service unavailable', { code: 'PUBLIC_APPEARANCE_UNAVAILABLE', statusCode: 503 });
      }
      return dependencies.storePublicAppearanceMedia(buffer);
    },

    publishPublicAppearance(pluginName: string, payload: unknown) {
      requirePublicAppearancePlugin(pluginName);
      if (!dependencies.publishPublicAppearance) {
        throw new AppError('Public appearance service unavailable', { code: 'PUBLIC_APPEARANCE_UNAVAILABLE', statusCode: 503 });
      }
      const appearance = dependencies.publishPublicAppearance(pluginName, payload);
      return { success: true, appearance };
    },

    clearPublicAppearance(pluginName: string) {
      validatePluginName(pluginName);
      dependencies.clearPublicAppearance?.(pluginName);
      return { success: true };
    },

    async prepareUsageDashboard() {
      const directory = dependencies.getBundledUsageDirectory?.();
      if (!directory) return this.prepareRpc('claude-usage');
      // Older user-installed versions can shadow the bundled plugin and lack
      // /dashboard. Local history must use the implementation shipped with the UI.
      const sharedPort = dependencies.getPluginDirectory('claude-usage') === directory
        ? dependencies.getServerPort('claude-usage') : undefined;
      // Not a valid installable plugin name: users cannot shadow this internal worker.
      const worker = '@claudeweb/local-history';
      const port = sharedPort || dependencies.getServerPort(worker)
        || await dependencies.startServer(worker, directory, 'dist/server.js');
      return { port, secrets: {} };
    },

    async uninstall(pluginName: string, options?: { removeData?: boolean }) {
      validatePluginName(pluginName);
      dependencies.revokeMediaTickets?.(pluginName);
      dependencies.clearPublicAppearance?.(pluginName);
      if (dependencies.isServerRunning(pluginName)) await dependencies.stopServer(pluginName);
      await dependencies.uninstall(pluginName, options);
      return { success: true, name: pluginName };
    },
  };
}

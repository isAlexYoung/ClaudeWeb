import fs from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import { loginSessionAlive } from '@/modules/auth/index.js';

import { createMediaTicketService } from './media-ticket.service.js';
import {
  getHostVersion,
  getPluginPort,
  getPluginProcessState,
  isPluginRunning,
  resetPluginCircuit,
  startPluginServer,
  stopPluginServer,
} from './plugin-process.service.js';
import {
  getPluginDir,
  getPluginsConfig,
  installPluginFromGit,
  resolvePluginAssetPath,
  savePluginsConfig,
  scanPlugins,
  uninstallPlugin,
  updatePluginFromGit,
} from './plugin-registry.service.js';
import {
  createPluginMediaRouter,
  createPluginsRouter,
  createPublicAppearanceRouter,
} from './plugins.routes.js';
import { createPluginsService } from './plugins.service.js';
import { createPublicAppearanceService } from './public-appearance.service.js';

const mediaTicketService = createMediaTicketService({
  sessionAlive: loginSessionAlive,
});

const publicAppearanceService = createPublicAppearanceService({
  isPluginAllowed: (pluginName) => {
    const plugin = scanPlugins().find((p) => p.name === pluginName);
    if (!plugin || !plugin.enabled || plugin.publicAppearance !== true) return false;
    const config = getPluginsConfig();
    if (Array.isArray(plugin.slots) && plugin.slots.includes('background')) {
      return config._host?.activeBackgroundPlugin === pluginName;
    }
    return true;
  },
});

const pluginsService = createPluginsService({
  scanPlugins,
  readConfig: getPluginsConfig,
  saveConfig: savePluginsConfig,
  getPluginDirectory: getPluginDir,
  getBundledUsageDirectory: () => {
    const root = process.env.CLAUDEWEB_BUNDLED_PLUGINS_DIR;
    if (!root) return null;
    const directory = path.join(root, 'claude-usage');
    return fs.existsSync(path.join(directory, 'dist/server.js')) ? directory : null;
  },
  resolveAsset: resolvePluginAssetPath,
  assetIsFile: (assetPath) => { try { return fs.statSync(assetPath).isFile(); } catch { return false; } },
  contentType: (assetPath) => mime.lookup(assetPath) || 'application/octet-stream',
  install: installPluginFromGit,
  update: updatePluginFromGit,
  uninstall: async (pluginName, options) => { await uninstallPlugin(pluginName, options); },
  startServer: startPluginServer,
  stopServer: async (pluginName) => { await stopPluginServer(pluginName); },
  getServerPort: getPluginPort,
  isServerRunning: isPluginRunning,
  getProcessState: getPluginProcessState,
  resetCircuit: resetPluginCircuit,
  getHostVersion,
  createMediaTicket: (input) => mediaTicketService.createTicket(input),
  resolveMediaTicket: (pluginName, ticketId) => mediaTicketService.resolveTicket(pluginName, ticketId),
  revokeMediaTickets: (pluginName) => mediaTicketService.revokeForPlugin(pluginName),
  storePublicAppearanceMedia: (buffer) => publicAppearanceService.storeMediaBuffer(buffer),
  publishPublicAppearance: (pluginName, payload) => publicAppearanceService.publish(pluginName, payload),
  clearPublicAppearance: (pluginName) => publicAppearanceService.clear(pluginName),
  logError: (message, error) => console.error(message, error),
});

/** Authenticated plugin router assembled with filesystem, loader, process and ticket adapters. */
export const pluginsRoutes = createPluginsRouter(pluginsService);

/** Scoped ticket-authenticated media streaming router (mounted before bearer middleware). */
export const pluginMediaRoutes = createPluginMediaRouter(pluginsService);

/** Unauthenticated public login-screen appearance router. */
export const publicAppearanceRoutes = createPublicAppearanceRouter(publicAppearanceService);

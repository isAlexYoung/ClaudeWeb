// pluginsRoutes: used by the server entrypoint to mount protected plugin-management endpoints.
export { pluginMediaRoutes, pluginsRoutes, publicAppearanceRoutes } from './plugins.module.js';

// startEnabledPluginServers: used by the server entrypoint to start enabled plugin subprocesses.
export { startEnabledPluginServers } from './plugin-process.service.js';
// stopAllPlugins: used by the server entrypoint to stop plugin subprocesses during shutdown.
export { stopAllPlugins } from './plugin-process.service.js';
// getPluginPort: used by WebSocket setup in the server entrypoint to proxy plugin connections.
export { getPluginPort } from './plugin-process.service.js';
// scanPlugins: used by Backup to record which plugins are installed (names and sources only).
export { scanPlugins } from './plugin-registry.service.js';

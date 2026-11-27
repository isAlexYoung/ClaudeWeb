import type { McpConnectionStatus } from '@/shared/types';

const PLATFORMS = new Set(['windows', 'linux', 'mac']);
const ROUTES = new Set(['web', 'ssh']);

/**
 * Used by WorkspaceContextInspector: a CMCP connector is named after the computer and the way
 * it is reached ("windows-web", "mac-ssh", "windows-web + ssh") instead of CMCP's internal
 * name; any other connector keeps its configured name.
 */
export function connectorLabel(server: McpConnectionStatus): string {
  const routes = Array.isArray(server.routes) ? server.routes.filter((route) => ROUTES.has(route)) : [];
  if (!routes.length) return server.name;
  const joined = [...new Set(routes)].join(' + ');
  return server.platform && PLATFORMS.has(server.platform) ? `${server.platform}-${joined}` : joined;
}

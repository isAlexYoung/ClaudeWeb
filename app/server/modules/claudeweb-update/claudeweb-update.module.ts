import { createClaudeWebUpdateRouter } from '@/modules/claudeweb-update/claudeweb-update.routes.js';
import { createClaudeWebUpdateService } from '@/modules/claudeweb-update/claudeweb-update.service.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

// The service unit names the root updater's socket and status file; elsewhere both are
// unset and the About page only shows the version.
const claudeWebUpdateService = createClaudeWebUpdateService({
  appRoot: findApplicationRoot(getModuleDirectory(import.meta.url)),
  socketPath: process.env.CLAUDEWEB_UPDATE_SOCKET,
  statusPath: process.env.CLAUDEWEB_UPDATE_STATUS,
});

/** ClaudeWeb update router assembled for the authenticated server mount at `/api/claudeweb-update`. */
export const claudeWebUpdateRoutes = createClaudeWebUpdateRouter(claudeWebUpdateService);

import os from 'node:os';

import { createDesktopService } from '@/modules/claude-desktop/claude-desktop.service.js';
import { createDesktopRouter } from '@/modules/claude-desktop/claude-desktop.routes.js';

/** Used by server startup and the authenticated WebSocket gateway. */
export const desktopService = createDesktopService(os.homedir());
/** Used by server startup to mount the authenticated ClaudeDesktop API. */
export const desktopRoutes = createDesktopRouter(desktopService);

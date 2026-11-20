import { createBrowserRouter } from '@/modules/browser/browser.routes.js';
import { createBrowserService } from '@/modules/browser/browser.service.js';

// WebDesktop's service unit names the gateway socket that offers the desktop's browser;
// elsewhere it is unset and the panel says the browser needs WebDesktop.
export const browserService = createBrowserService({ socketPath: process.env.CLAUDEWEB_GUI_SOCKET });

/** Browser panel router assembled for the authenticated server mount at `/api/browser`. */
export const browserRoutes = createBrowserRouter(browserService);

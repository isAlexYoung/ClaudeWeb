import { createBrowserRouter } from '@/modules/browser/browser.routes.js';
import { createBrowserService } from '@/modules/browser/browser.service.js';

// The service unit names the local socket that offers the server's browser;
// when it is unset the panel says the browser is not available.
export const browserService = createBrowserService({ socketPath: process.env.CLAUDEWEB_GUI_SOCKET });

/** Browser panel router assembled for the authenticated server mount at `/api/browser`. */
export const browserRoutes = createBrowserRouter(browserService);

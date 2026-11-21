import os from 'node:os';

import { createBrowserRouter } from '@/modules/browser/browser.routes.js';
import { createBrowserService } from '@/modules/browser/browser.service.js';

// The browser runs as the service account; CLAUDEWEB_CHROMIUM may name the
// Chromium to use, otherwise the newest Playwright Chromium in the home cache.
export const browserService = createBrowserService({
  homeDirectory: os.homedir(),
  chromiumPath: process.env.CLAUDEWEB_CHROMIUM || undefined,
});

/** Browser panel router assembled for the authenticated server mount at `/api/browser`. */
export const browserRoutes = createBrowserRouter(browserService);

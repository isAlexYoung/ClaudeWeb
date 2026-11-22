import { createGraphicalSessionService } from '@/modules/graphical-session/index.js';

/** Browser module and its tests use the shared graphical lifecycle with a Chromium profile. */
export function createBrowserService(options: { homeDirectory: string; chromiumPath?: string }) {
  return createGraphicalSessionService(options);
}

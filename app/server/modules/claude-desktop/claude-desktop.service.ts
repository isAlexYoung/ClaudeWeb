import { createGraphicalSessionService } from '@/modules/graphical-session/index.js';

/** ClaudeDesktop module and its tests select the official app with a private persistent profile. */
export function createDesktopService(homeDirectory: string) {
  return createGraphicalSessionService({ homeDirectory, application: 'claude-desktop' });
}

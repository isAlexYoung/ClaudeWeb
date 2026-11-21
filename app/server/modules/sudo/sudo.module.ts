import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createSudoRouter } from './sudo.routes.js';
import { createSudoService } from './sudo.service.js';

const SUDO = '/usr/bin/sudo';
const shimDirectory = path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), 'sudo-shim');
const socketPath = process.env.CLAUDEWEB_SUDO_SOCKET_PATH || path.join(os.homedir(), '.cache', 'claudeweb', 'sudo.sock');

let service: ReturnType<typeof createSudoService> | null = null;

/**
 * Started by the server on Linux where sudo is installed. Elsewhere (Windows
 * development, no sudo) Claude's `sudo` stays the system's own. `announce`
 * tells the pages the list changed (the server passes its websocket
 * broadcast: the websocket module imports the chat runtime, which imports
 * this one).
 */
export async function startSudoConfirmation({ announce }: { announce: () => void }) {
  if (process.platform !== 'linux' || !fs.existsSync(SUDO) || !fs.existsSync(path.join(shimDirectory, 'sudo'))) return;
  const created = createSudoService({ socketPath, sudoPath: SUDO, announce });
  try {
    await created.start();
    service = created;
  } catch (error) {
    console.warn('[sudo] confirmation is not available:', error instanceof Error ? error.message : String(error));
  }
}

/** What Claude's processes need for their `sudo` to ask the user; nothing when inactive. */
export function sudoShimEnvironment(hostPath: string | undefined): Record<string, string> {
  if (!service) return {};
  return {
    PATH: [shimDirectory, hostPath].filter(Boolean).join(path.delimiter),
    CLAUDEWEB_SUDO_SOCKET: socketPath,
    CLAUDEWEB_NODE: process.execPath,
  };
}

/** Mounted at `/api/sudo` behind authentication. */
export const sudoRoutes = createSudoRouter(() => service);

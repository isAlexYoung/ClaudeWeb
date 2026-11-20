import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

/** One newer version offered by the root updater's catalogue (fa-build claudeweb.json). */
export type ClaudeWebAvailableVersion = {
  version: string;
  notes: string;
  requires_webdesktop: string;
  compatible: boolean;
  download_bytes: number;
};

/** Written by the root updater to /var/lib/wd-claudeweb/status.json while it works. */
export type ClaudeWebUpdateStatus = {
  state: 'idle' | 'queued' | 'checking' | 'downloading' | 'installing' | 'restarting' | 'done' | 'failed';
  version?: string;
  installed?: string | null;
  error?: string;
  updated_at?: number;
};

type Dependencies = {
  appRoot: string;
  /** Root's request socket; unset outside WebDesktop. */
  socketPath: string | undefined;
  statusPath: string | undefined;
  /** Sends one JSON line and resolves the one-line JSON reply (replaceable in tests). */
  request?: (socketPath: string, message: object) => Promise<Record<string, unknown>>;
};

const VERSION = /^(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;
const REQUEST_TIMEOUT_MS = 40_000;
const MAX_REPLY_BYTES = 256 * 1024;

function socketRequest(socketPath: string, message: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let reply = '';
    let settled = false;
    const finish = (error: Error | null, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value ?? {});
    };
    socket.setEncoding('utf8');
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => finish(new Error('timeout')));
    socket.on('connect', () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on('data', (chunk: string) => {
      reply += chunk;
      if (reply.length > MAX_REPLY_BYTES) finish(new Error('reply too large'));
      else if (reply.includes('\n')) {
        try {
          finish(null, JSON.parse(reply.slice(0, reply.indexOf('\n'))) as Record<string, unknown>);
        } catch (error) {
          finish(error as Error);
        }
      }
    });
    socket.on('error', (error) => finish(error));
    socket.on('end', () => finish(new Error('closed without a reply')));
  });
}

/**
 * Created by the claudeweb-update module for Settings > About: reads the installed
 * prebuilt version and asks WebDesktop's root updater (wd-claudeweb-update.socket) to
 * check or install a newer one. Root decides what is allowed; this only relays.
 */
export function createClaudeWebUpdateService(dependencies: Dependencies) {
  const send = dependencies.request ?? socketRequest;

  async function installedVersion(): Promise<string | null> {
    try {
      const value = JSON.parse(await fs.readFile(path.join(dependencies.appRoot, 'claudeweb.json'), 'utf8')) as { version?: unknown };
      return typeof value.version === 'string' && VERSION.test(value.version) ? value.version : null;
    } catch {
      return null;
    }
  }

  async function supported(): Promise<boolean> {
    if (!dependencies.socketPath) return false;
    try {
      return (await fs.stat(dependencies.socketPath)).isSocket();
    } catch {
      return false;
    }
  }

  async function readStatus(): Promise<ClaudeWebUpdateStatus> {
    if (!dependencies.statusPath) return { state: 'idle' };
    try {
      const value = JSON.parse(await fs.readFile(dependencies.statusPath, 'utf8')) as ClaudeWebUpdateStatus;
      return typeof value?.state === 'string' ? value : { state: 'idle' };
    } catch {
      return { state: 'idle' };
    }
  }

  async function ask(message: object): Promise<Record<string, unknown>> {
    if (!(await supported())) {
      throw new AppError('Updating ClaudeWeb is only available inside WebDesktop.', { code: 'CLAUDEWEB_UPDATE_UNSUPPORTED', statusCode: 409 });
    }
    let reply: Record<string, unknown>;
    try {
      reply = await send(dependencies.socketPath as string, message);
    } catch {
      throw new AppError('The WebDesktop updater did not answer.', { code: 'CLAUDEWEB_UPDATER_UNAVAILABLE', statusCode: 502 });
    }
    if (reply.ok !== true) {
      const code = typeof reply.error === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(reply.error) ? reply.error : 'CLAUDEWEB_UPDATE_FAILED';
      throw new AppError(code, { code, statusCode: 409 });
    }
    return reply;
  }

  return {
    /** Installed version, whether this host can update, and the updater's last progress. */
    async status() {
      return { supported: await supported(), installed: await installedVersion(), status: await readStatus() };
    },

    /** Newer versions in the catalogue, newest first, with whether this WebDesktop can run them. */
    async check() {
      const reply = await ask({ op: 'check' });
      const newer = Array.isArray(reply.newer) ? (reply.newer as ClaudeWebAvailableVersion[]) : [];
      return {
        installed: (reply.installed as string | null) ?? null,
        webdesktop: (reply.webdesktop as string | undefined) ?? null,
        latest: (reply.latest as string | null) ?? null,
        newer,
      };
    },

    /** Starts the root update to `version`; ClaudeWeb restarts while it runs. */
    async update(version: unknown) {
      if (typeof version !== 'string' || !VERSION.test(version)) {
        throw new AppError('Choose a version to install.', { code: 'CLAUDEWEB_VERSION_INVALID', statusCode: 400 });
      }
      await ask({ op: 'update', version });
      return { started: true, version };
    },
  };
}

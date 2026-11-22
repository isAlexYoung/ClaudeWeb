import { spawn as spawnProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

/**
 * sudo for Claude, confirmed by the user in ClaudeWeb.
 *
 * Claude's commands run without a terminal, where sudo cannot ask for a
 * password. The chat's PATH starts with a `sudo` shim (app/bin/sudo) that
 * hands the command line to this service over a unix socket only the
 * claudeweb user can open. Every signed-in page shows the request; when the
 * user agrees and types the sudo password, this service runs the real sudo
 * with `-S -k`: the password goes to sudo's standard input once and nowhere
 * else (not to Claude, the logs, the browser's storage or a file), and sudo
 * keeps no cached credentials. Only the command's output and exit code go
 * back to Claude. A refusal, a timeout or a wrong password fails the command
 * once; nothing is retried.
 */

/** A request waiting for the user, as the page shows it. */
export type SudoRequest = {
  id: string;
  /** The arguments after `sudo`, exactly as they will be run. */
  argv: string[];
  cwd: string;
  createdAt: number;
  expiresAt: number;
};

type Outcome = 'denied' | 'timeout' | 'password' | 'ran' | 'failed';

type Pending = SudoRequest & {
  socket: net.Socket;
  stdin: Buffer;
  settle: (answer: { approve: boolean; password?: string }, outcome?: Outcome) => void;
};

type Dependencies = {
  socketPath: string;
  sudoPath?: string;
  /** How long a request waits for the user. */
  timeoutMs?: number;
  /** Tells the pages that the list of requests changed. */
  announce: () => void;
  spawn?: typeof spawnProcess;
  now?: () => number;
};

const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const MAX_ARGS = 256;
const MAX_ARGV_BYTES = 32 * 1024;
const MAX_PENDING = 8;
const MAX_PASSWORD_LENGTH = 1024;

function frame(socket: net.Socket, value: Record<string, unknown>) {
  if (!socket.destroyed) socket.write(`${JSON.stringify(value)}\n`);
}

function parseRequest(line: string): { argv: string[]; cwd: string; stdin: Buffer } | null {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const { argv, cwd, stdin } = value as { argv?: unknown; cwd?: unknown; stdin?: unknown };
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_ARGS
    || argv.some((item) => typeof item !== 'string' || item.includes('\0'))) return null;
  if (Buffer.byteLength(argv.join('\0')) > MAX_ARGV_BYTES) return null;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')) return null;
  if (stdin !== undefined && typeof stdin !== 'string') return null;
  const input = typeof stdin === 'string' ? Buffer.from(stdin, 'base64') : Buffer.alloc(0);
  if (input.length > MAX_STDIN_BYTES) return null;
  return { argv: argv as string[], cwd, stdin: input };
}

export function createSudoService({ socketPath, sudoPath = '/usr/bin/sudo', timeoutMs = 5 * 60_000, announce, spawn = spawnProcess, now = Date.now }: Dependencies) {
  const pending = new Map<string, Pending>();
  let server: net.Server | null = null;

  const finish = (socket: net.Socket, code: number, outcome: Outcome) => {
    frame(socket, { t: 'exit', code, outcome });
    socket.end();
  };

  /** Runs the approved command; the password is written to sudo once and dropped. */
  function run(request: Pending, password: string) {
    const { socket } = request;
    let child: ReturnType<typeof spawnProcess>;
    try {
      child = spawn(sudoPath, ['-S', '-k', '-p', '', ...request.argv], {
        cwd: fs.existsSync(request.cwd) ? request.cwd : undefined,
        env: {
          PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          HOME: process.env.HOME ?? '/',
          LANG: 'C.UTF-8',
          USER: process.env.USER ?? '',
          LOGNAME: process.env.LOGNAME ?? '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      finish(socket, 1, 'failed');
      return;
    }
    let wrongPassword = false;
    let authenticationMessage = '';
    let done = false;
    child.stdout?.on('data', (data: Buffer) => frame(socket, { t: 'out', fd: 1, data: data.toString('base64') }));
    child.stderr?.on('data', (data: Buffer) => {
      // sudo.ws and sudo-rs use different messages; pipe chunks may split a phrase.
      authenticationMessage = (authenticationMessage + data.toString()).slice(-256);
      if (/incorrect password attempt|Sorry, try again|Authentication failed, try again/i.test(authenticationMessage)) wrongPassword = true;
      frame(socket, { t: 'out', fd: 2, data: data.toString('base64') });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.write(`${password}\n`);
    child.stdin?.end(request.stdin);
    child.once('error', () => { if (!done) { done = true; finish(socket, 1, 'failed'); } });
    child.once('close', (code, signal) => {
      if (done) return;
      done = true;
      finish(socket, code ?? (signal ? 128 : 1), wrongPassword && code !== 0 ? 'password' : 'ran');
    });
    // The caller went away (Claude's command was stopped): so does the command.
    socket.once('close', () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  }

  function receive(socket: net.Socket) {
    let buffered = '';
    let received = false;
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('data', (chunk: string) => {
      if (received) return;
      buffered += chunk;
      if (buffered.length > MAX_REQUEST_BYTES) { socket.destroy(); return; }
      const end = buffered.indexOf('\n');
      if (end < 0) return;
      received = true;
      const parsed = parseRequest(buffered.slice(0, end));
      buffered = '';
      if (!parsed) { finish(socket, 2, 'failed'); return; }
      if (pending.size >= MAX_PENDING) { finish(socket, 1, 'denied'); return; }

      const id = randomBytes(12).toString('base64url');
      const createdAt = now();
      let settled = false;
      let request: Pending;
      const settle = (answer: { approve: boolean; password?: string }, outcome: Outcome = 'denied') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(id);
        announce();
        if (answer.approve && typeof answer.password === 'string') run(request, answer.password);
        else finish(socket, 1, outcome);
      };
      const timer = setTimeout(() => settle({ approve: false }, 'timeout'), timeoutMs);
      timer.unref?.();
      request = { id, argv: parsed.argv, cwd: parsed.cwd, stdin: parsed.stdin, createdAt, expiresAt: createdAt + timeoutMs, socket, settle };
      pending.set(id, request);
      // Claude's command was stopped while waiting: the question goes away.
      socket.once('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(id);
        announce();
      });
      announce();
    });
  }

  return {
    /** Listens on the socket the chat's `sudo` shim connects to. */
    async start() {
      fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
      fs.chmodSync(path.dirname(socketPath), 0o700);
      fs.rmSync(socketPath, { force: true });
      const listening = net.createServer(receive);
      server = listening;
      await new Promise<void>((resolve, reject) => {
        listening.once('error', reject);
        listening.listen(socketPath, () => { listening.off('error', reject); resolve(); });
      });
      fs.chmodSync(socketPath, 0o600);
    },

    /** The requests waiting for the user, oldest first. */
    list(): SudoRequest[] {
      return [...pending.values()]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map(({ id, argv, cwd, createdAt, expiresAt }) => ({ id, argv, cwd, createdAt, expiresAt }));
    },

    /** The user's answer. Agreeing needs the sudo password; it is used once and not kept. */
    answer(id: unknown, input: { approve?: unknown; password?: unknown }) {
      const request = typeof id === 'string' ? pending.get(id) : undefined;
      if (!request) {
        throw new AppError('This sudo request is no longer waiting.', { code: 'SUDO_REQUEST_GONE', statusCode: 404 });
      }
      if (input.approve === true) {
        const password = input.password;
        if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH || /[\r\n\0]/.test(password)) {
          throw new AppError('Enter the sudo password.', { code: 'SUDO_PASSWORD_REQUIRED', statusCode: 400 });
        }
        request.settle({ approve: true, password });
      } else {
        request.settle({ approve: false });
      }
      return { success: true };
    },

    async close() {
      for (const request of [...pending.values()]) request.settle({ approve: false });
      const listening = server;
      server = null;
      await new Promise<void>((resolve) => { if (listening) listening.close(() => resolve()); else resolve(); });
      fs.rmSync(socketPath, { force: true });
    },
  };
}

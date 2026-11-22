import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils.js';

import { createSudoService } from '../sudo.service.js';

// Unix sockets: the service only runs on Linux.
const unix = { skip: process.platform === 'win32' };

// Stands in for /usr/bin/sudo: checks the four options the service always
// passes, reads the password line from stdin, then reports what it would run.
const FAKE_SUDO = `
const args = process.argv.slice(2);
const fixed = args.slice(0, 4).join(' ');
const command = args.slice(4);
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const newline = input.indexOf('\\n');
  const password = input.slice(0, newline);
  const rest = input.slice(newline + 1);
  if (fixed !== '-S -k -p ') { process.stderr.write('unexpected options: ' + fixed); process.exit(9); }
  if (password !== 'right-sudo-password') {
    process.stderr.write('Sorry, try again.\\nsudo: 1 incorrect password attempt\\n');
    process.exit(1);
  }
  process.stdout.write('ran: ' + command.join(' ') + (rest ? ' with input ' + rest : ''));
  process.exit(command[0] === 'false' ? 1 : 0);
});
`;

function harness(timeoutMs = 60_000, program = FAKE_SUDO) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-sudo-'));
  const script = path.join(directory, 'fake-sudo.cjs');
  fs.writeFileSync(script, program);
  let announced = 0;
  const service = createSudoService({
    socketPath: path.join(directory, 'run', 'sudo.sock'),
    sudoPath: '/usr/bin/sudo',
    timeoutMs,
    announce: () => { announced += 1; },
    spawn: ((_command: string, args: string[], options: object) => spawn(process.execPath, [script, ...args], options)) as never,
  });
  return {
    service,
    socketPath: path.join(directory, 'run', 'sudo.sock'),
    announced: () => announced,
    cleanup: async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

type Frames = { stdout: string; stderr: string; exit?: { code: number; outcome: string } };

/** What the `sudo` shim does: one request line, then frames until the end. */
function ask(socketPath: string, request: Record<string, unknown>): { socket: net.Socket; done: Promise<Frames> } {
  const socket = net.connect(socketPath);
  const frames: Frames = { stdout: '', stderr: '' };
  let buffered = '';
  socket.setEncoding('utf8');
  socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
      const message = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (message.t === 'out') frames[message.fd === 2 ? 'stderr' : 'stdout'] += Buffer.from(message.data, 'base64').toString();
      if (message.t === 'exit') frames.exit = { code: message.code, outcome: message.outcome };
    }
  });
  const done = new Promise<Frames>((resolve) => { socket.on('close', () => resolve(frames)); });
  return { socket, done };
}

async function waitFor<T>(read: () => T | undefined, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error('condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const rejectsWith = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

test('a sudo request waits for the user, and an approval runs it with the password on sudo\'s stdin only', unix, async () => {
  const h = harness();
  await h.service.start();
  try {
    assert.equal(fs.statSync(h.socketPath).mode & 0o777, 0o600, 'only the claudeweb user can ask');
    const { done } = ask(h.socketPath, { argv: ['apt-get', 'install', '-y', 'htop'], cwd: '/tmp' });
    const [request] = await waitFor(() => (h.service.list().length ? h.service.list() : undefined));
    assert.deepEqual(request.argv, ['apt-get', 'install', '-y', 'htop']);
    assert.equal(request.cwd, '/tmp');
    assert.ok(request.expiresAt > request.createdAt);
    assert.ok(h.announced() >= 1, 'the pages hear about the request');

    h.service.answer(request.id, { approve: true, password: 'right-sudo-password' });
    const frames = await done;
    assert.deepEqual(frames.exit, { code: 0, outcome: 'ran' });
    assert.equal(frames.stdout, 'ran: apt-get install -y htop');
    assert.ok(!JSON.stringify(frames).includes('right-sudo-password'), 'the password never goes back to the caller');
    assert.deepEqual(h.service.list(), []);
  } finally {
    await h.cleanup();
  }
});

test('refusing, a wrong password and an unanswered request each fail the command once', unix, async () => {
  const h = harness(400);
  await h.service.start();
  try {
    const denied = ask(h.socketPath, { argv: ['reboot'], cwd: '/' });
    const [first] = await waitFor(() => (h.service.list().length ? h.service.list() : undefined));
    h.service.answer(first.id, { approve: false });
    assert.deepEqual((await denied.done).exit, { code: 1, outcome: 'denied' });

    const wrong = ask(h.socketPath, { argv: ['id'], cwd: '/' });
    const [second] = await waitFor(() => (h.service.list().length ? h.service.list() : undefined));
    h.service.answer(second.id, { approve: true, password: 'wrong' });
    const wrongFrames = await wrong.done;
    assert.deepEqual(wrongFrames.exit, { code: 1, outcome: 'password' });
    assert.ok(!wrongFrames.stdout.includes('ran:'), 'nothing ran');

    const late = ask(h.socketPath, { argv: ['id'], cwd: '/' });
    assert.deepEqual((await late.done).exit, { code: 1, outcome: 'timeout' });
    assert.deepEqual(h.service.list(), []);
  } finally {
    await h.cleanup();
  }
});

test('sudo-rs authentication errors split across pipe chunks report a wrong password', unix, async () => {
  const program = FAKE_SUDO.replace(
    "process.stderr.write('Sorry, try again.\\nsudo: 1 incorrect password attempt\\n');",
    "process.stderr.write('sudo: Authenti'); setTimeout(() => { process.stderr.write('cation failed, try again.\\nsudo: Authentication required but not attempted\\n'); process.exit(1); }, 30); return;",
  );
  assert.notEqual(program, FAKE_SUDO, 'the fixture must use sudo-rs wording');
  const h = harness(60_000, program);
  await h.service.start();
  try {
    const wrong = ask(h.socketPath, { argv: ['id'], cwd: '/' });
    const [request] = await waitFor(() => (h.service.list().length ? h.service.list() : undefined));
    h.service.answer(request.id, { approve: true, password: 'wrong' });
    const frames = await wrong.done;
    assert.deepEqual(frames.exit, { code: 1, outcome: 'password' });
    assert.equal(frames.stdout, '');
    assert.match(frames.stderr, /Authentication failed, try again/);
  } finally {
    await h.cleanup();
  }
});

test('piped input reaches the command, after the password', unix, async () => {
  const h = harness();
  await h.service.start();
  try {
    const { done } = ask(h.socketPath, { argv: ['tee', '/etc/example'], cwd: '/', stdin: Buffer.from('hello').toString('base64') });
    const [request] = await waitFor(() => (h.service.list().length ? h.service.list() : undefined));
    h.service.answer(request.id, { approve: true, password: 'right-sudo-password' });
    assert.equal((await done).stdout, 'ran: tee /etc/example with input hello');
  } finally {
    await h.cleanup();
  }
});

test('a stopped command takes its question away; bad requests and answers are refused', unix, async () => {
  const h = harness();
  await h.service.start();
  try {
    const { socket } = ask(h.socketPath, { argv: ['id'], cwd: '/' });
    await waitFor(() => (h.service.list().length ? true : undefined));
    socket.destroy();
    await waitFor(() => (h.service.list().length === 0 ? true : undefined));

    for (const bad of [{ argv: [], cwd: '/' }, { argv: ['id'], cwd: 'relative' }, { argv: [1], cwd: '/' }]) {
      assert.deepEqual((await ask(h.socketPath, bad).done).exit, { code: 2, outcome: 'failed' });
    }

    const pending = ask(h.socketPath, { argv: ['id'], cwd: '/' });
    const [request] = await waitFor(() => (h.service.list().length ? h.service.list() : undefined));
    assert.throws(() => h.service.answer(request.id, { approve: true }), rejectsWith('SUDO_PASSWORD_REQUIRED'));
    assert.throws(() => h.service.answer(request.id, { approve: true, password: 'a\nb' }), rejectsWith('SUDO_PASSWORD_REQUIRED'));
    assert.throws(() => h.service.answer('unknown', { approve: false }), rejectsWith('SUDO_REQUEST_GONE'));
    h.service.answer(request.id, { approve: false });
    await pending.done;
  } finally {
    await h.cleanup();
  }
});

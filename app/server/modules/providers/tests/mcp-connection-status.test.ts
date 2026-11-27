import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveMcpConnections } from '@/modules/providers/services/mcp-connection-status.service.js';
import type { ProviderMcpServer } from '@/shared/types.js';

const socketPath = () => process.platform === 'win32' ? `\\\\.\\pipe\\claudeweb-status-${randomUUID()}`
  : path.join(os.tmpdir(), `cw-${randomUUID()}.sock`);
const cmcp = (name: string, socket: string): ProviderMcpServer => ({
  provider: 'claude', name, scope: 'user', transport: 'stdio', command: 'must-never-be-started',
  args: ['-u', `/home/user/.local/share/cloudpc-link/${name}/connector.py`, 'serve'], env: { CLOUDPC_LINK_SOCKET: socket },
});

test('one shared bridge reports only the actual Linux PC as connected, then reflects disconnect and handshake', async () => {
  const socket = socketPath();
  let connected = true;
  let hasPc = true;
  let handshakes = 0;
  const server = net.createServer((client) => {
    client.once('data', (data) => {
      const request = JSON.parse(data.toString());
      if (request.op === 'status') client.end(JSON.stringify({ ok: true, connected, pc: hasPc ? { machine: 'test' } : null }) + '\n');
      else {
        assert.equal(request.msg.method, 'initialize');
        handshakes++;
        client.end(JSON.stringify({ ok: true, msg: { result: { serverInfo: { name: 'linux-pc-files' } } } }) + '\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  try {
    const servers = [cmcp('windows-pc-files', socket), cmcp('linux-pc-files', socket)];
    assert.deepEqual(await resolveMcpConnections(servers, [{ name: 'windows-pc-files', status: 'connected' }]), [
      { name: 'windows-pc-files', status: 'disconnected', platform: 'windows', routes: ['web'] },
      { name: 'linux-pc-files', status: 'connected', platform: 'linux', routes: ['web'] },
    ]);
    assert.equal(handshakes, 1, 'one identity read per shared socket');
    connected = false;
    assert.ok((await resolveMcpConnections(servers, [])).every((entry) => entry.status === 'disconnected'));
    connected = true; hasPc = false;
    assert.ok((await resolveMcpConnections(servers, [])).every((entry) => entry.status === 'connecting'));
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
});

test('an offline CMCP bridge cannot be marked online by cached SDK MCP configuration', async () => {
  const servers = [cmcp('linux-pc-files', socketPath())];
  assert.deepEqual(await resolveMcpConnections(servers, [{ name: 'linux-pc-files', status: 'connected' }]), [
    { name: 'linux-pc-files', status: 'disconnected', platform: 'linux', routes: ['web'] },
  ]);
});

// The managed connector finds each route's relay as a Unix socket beside it; Windows has none.
test('a CMCP 4.25 managed connector is connected when its chosen route reaches this PC', { skip: process.platform === 'win32' }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cw-cmcp-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = 'cmcp-pc-0123abcd';
  const servers: ProviderMcpServer[] = [{
    provider: 'claude', name, scope: 'user', transport: 'stdio', command: 'must-never-be-started',
    args: ['-u', path.join(root, name, 'connector.py'), 'serve', '--name', name],
  }];
  const policy = { key: 'machine-key', name, ssh: 'cmcp-ssh-0123abcd', web: 'windows-pc-files', primary: 'url', dual: false };
  await mkdir(path.join(root, name), { recursive: true });
  const writePolicy = (change: Record<string, unknown> = {}) => writeFile(path.join(root, name, 'connection-policy.json'), JSON.stringify({ ...policy, ...change }));
  await writePolicy();

  let machine: string | null = 'machine-key';
  const relays: net.Server[] = [];
  const listen = async (route: string) => {
    await mkdir(path.join(root, route, 'relay'), { recursive: true });
    const relay = net.createServer((client) => client.once('data', () => {
      client.end(JSON.stringify({ ok: true, connected: true, pc: machine ? { machine } : null }) + '\n');
    }));
    await new Promise<void>((resolve) => relay.listen(path.join(root, route, 'relay', 'link.sock'), resolve));
    relays.push(relay);
  };
  t.after(() => Promise.all(relays.map((relay) => new Promise((resolve) => relay.close(resolve)))));

  // No relay yet, and an SDK cache claiming otherwise does not count.
  const route = (status: string, routes: string[]) => [{ name, status, platform: 'windows', routes }];
  // While nothing is connected the primary route is named.
  assert.deepEqual(await resolveMcpConnections(servers, [{ name, status: 'connected' }]), route('disconnected', ['web']));
  await writePolicy({ primary: 'ssh' });
  assert.deepEqual(await resolveMcpConnections(servers, []), route('disconnected', ['ssh']));
  await writePolicy();
  // Only the SSH relay runs while the policy uses the URL route.
  await listen('cmcp-ssh-0123abcd');
  assert.deepEqual(await resolveMcpConnections(servers, []), route('disconnected', ['web']));
  await writePolicy({ dual: true });
  assert.deepEqual(await resolveMcpConnections(servers, []), route('connected', ['ssh']));
  await listen('windows-pc-files');
  assert.deepEqual(await resolveMcpConnections(servers, []), route('connected', ['web', 'ssh']));
  await writePolicy();
  assert.deepEqual(await resolveMcpConnections(servers, []), route('connected', ['web']));
  // A relay connected to another PC is not this connector's PC.
  machine = 'another-pc';
  assert.deepEqual(await resolveMcpConnections(servers, []), route('disconnected', ['web']));
  machine = null;
  assert.deepEqual(await resolveMcpConnections(servers, []), route('connecting', ['web']));
  // A route name that would leave the CMCP folder is refused.
  machine = 'machine-key';
  await writePolicy({ web: '../windows-pc-files' });
  assert.deepEqual(await resolveMcpConnections(servers, []), [{ name, status: 'disconnected' }]);
});

test('without a running Claude process ordinary connectors are not started, while CMCP still reports its PC', async () => {
  const servers: ProviderMcpServer[] = [
    { provider: 'claude', name: 'docs', scope: 'user', transport: 'http', url: 'https://example.test' },
    cmcp('linux-pc-files', socketPath()),
  ];
  assert.deepEqual(await resolveMcpConnections(servers, null), [
    { name: 'docs', status: 'idle' }, { name: 'linux-pc-files', status: 'disconnected', platform: 'linux', routes: ['web'] },
  ]);
});

test('a standalone CMCP 4.24 SSH connector is checked through its relay and named as SSH', async () => {
  const servers = [cmcp('cmcp-ssh-0123abcd', socketPath())];
  assert.deepEqual(await resolveMcpConnections(servers, [{ name: 'cmcp-ssh-0123abcd', status: 'connected' }]), [
    { name: 'cmcp-ssh-0123abcd', status: 'disconnected', routes: ['ssh'] },
  ]);
});

test('ordinary MCP connectors follow live SDK state and expose no configuration secrets', async () => {
  const servers = ['ready', 'waiting', 'failed', 'idle'].map((name): ProviderMcpServer => ({
    provider: 'claude', name, scope: 'user', transport: 'http', url: 'https://example.test', headers: { Authorization: 'secret' },
  }));
  assert.deepEqual(await resolveMcpConnections(servers, [
    { name: 'ready', status: 'connected' }, { name: 'waiting', status: 'pending' }, { name: 'failed', status: 'failed' },
  ]), [
    { name: 'ready', status: 'connected' }, { name: 'waiting', status: 'connecting' },
    { name: 'failed', status: 'disconnected' }, { name: 'idle', status: 'disconnected' },
  ]);
});

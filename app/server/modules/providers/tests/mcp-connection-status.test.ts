import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
      { name: 'windows-pc-files', status: 'disconnected' }, { name: 'linux-pc-files', status: 'connected' },
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
    { name: 'linux-pc-files', status: 'disconnected' },
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

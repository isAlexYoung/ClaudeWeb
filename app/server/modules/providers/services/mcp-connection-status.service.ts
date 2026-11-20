import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import type { McpConnectionStatus, ProviderMcpServer } from '@/shared/types.js';

const CMCP_NAMES = new Set(['windows-pc-files', 'linux-pc-files', 'mac-pc-files']);

type RelayReply = { ok?: boolean; connected?: boolean; pc?: unknown; msg?: { result?: { serverInfo?: { name?: unknown } } } };

/** Reads one bounded, read-only relay exchange; never executes a configured command. */
function exchange(socketPath: string, request: Record<string, unknown>): Promise<RelayReply> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => finish(new Error('Relay status timed out')), 2000);
    const finish = (error?: Error, result?: RelayReply) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result ?? {});
    };
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) { finish(new Error('Relay status too large')); return; }
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      try {
        const parsed: unknown = JSON.parse(buffer.slice(0, end));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid relay reply');
        finish(undefined, parsed as RelayReply);
      }
      catch { finish(new Error('Invalid relay status')); }
    });
    socket.once('error', (error) => finish(error));
    socket.once('end', () => finish(new Error('Relay closed before status')));
  });
}

/** Distinguishes the actual connected PC from obsolete Windows/Linux/Mac configuration entries. */
async function readRelay(socketPath: string): Promise<{ name?: string; status: McpConnectionStatus['status'] }> {
  try {
    const live = await exchange(socketPath, { id: 1, op: 'status' });
    if (live.ok !== true || live.connected !== true) return { status: 'disconnected' };
    if (!live.pc) return { status: 'connecting' };
    // Cached connector tools cannot identify which PC owns the bridge socket.
    const identity = await exchange(socketPath, { id: 2, op: 'call', msg: {
      jsonrpc: '2.0', id: 2, method: 'initialize', params: {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claudeweb-status', version: '1' },
      },
    } });
    const name = identity.msg?.result?.serverInfo?.name;
    return identity.ok === true && typeof name === 'string' ? { name, status: 'connected' } : { status: 'disconnected' };
  } catch { return { status: 'disconnected' }; }
}

/** Used by providerMcpService; CMCP reflects PC reachability, other servers reflect the live session's SDK. */
export async function resolveMcpConnections(
  servers: ProviderMcpServer[],
  runtime: Array<{ name: string; status: string }>,
): Promise<McpConnectionStatus[]> {
  const relays = new Map<string, ReturnType<typeof readRelay>>();
  return Promise.all(servers.map(async (server) => {
    const isCmcp = CMCP_NAMES.has(server.name) && server.transport === 'stdio'
      && server.args?.some((arg) => /(?:connector\.py|cloudpc-connector[^/\\]*\.py)$/.test(arg));
    if (isCmcp) {
      const socketPath = server.env?.CLOUDPC_LINK_SOCKET || process.env.CLOUDPC_LINK_SOCKET
        || path.join(os.homedir(), '.local', 'share', 'cloudpc-link', 'link.sock');
      if (!relays.has(socketPath)) relays.set(socketPath, readRelay(socketPath));
      const live = await relays.get(socketPath)!;
      return { name: server.name, status: live.status === 'connecting' ? 'connecting'
        : live.name === server.name ? live.status : 'disconnected' };
    }
    const live = runtime.find((entry) => entry.name === server.name)?.status;
    return { name: server.name, status: live === 'connected' ? 'connected' : live === 'pending' ? 'connecting' : 'disconnected' };
  }));
}

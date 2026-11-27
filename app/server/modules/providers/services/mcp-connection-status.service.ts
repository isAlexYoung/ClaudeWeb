import { readFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import type { McpConnectionStatus, McpConnectorPlatform, McpConnectorRoute, ProviderMcpServer } from '@/shared/types.js';

const CMCP_CONNECTOR = /(?:connector\.py|cloudpc-connector[^/\\]*\.py)$/;
// The URL route of each platform; CMCP 4.25 names it in the policy's `web` field.
const CMCP_WEB_NAME = /^(windows|linux|mac)-pc-files$/;
// A standalone SSH connector from CMCP 4.24 (before the per-PC connector).
const CMCP_SSH_NAME = /^cmcp-ssh-[A-Za-z0-9]{1,64}$/;
// A CMCP name used as a path segment: no separators, no dot-only names.
const CMCP_ROUTE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

type RelayReply = { ok?: boolean; connected?: boolean; pc?: unknown; msg?: { result?: { serverInfo?: { name?: unknown } } } };
type ConnectionDetails = Omit<McpConnectionStatus, 'name'>;

function webPlatform(name: string): McpConnectorPlatform | undefined {
  return CMCP_WEB_NAME.exec(name)?.[1] as McpConnectorPlatform | undefined;
}

/** The platform and routes only when known, so plain connectors keep their short shape. */
function details(status: McpConnectionStatus['status'], platform: McpConnectorPlatform | undefined, routes: McpConnectorRoute[]): ConnectionDetails {
  return { status, ...(platform ? { platform } : {}), ...(routes.length ? { routes } : {}) };
}

/**
 * CMCP 4.25+ registers one connector per PC (`cmcp-pc-<id>`) that forwards to the URL
 * route (`windows-pc-files`) and/or the SSH route (`cmcp-ssh-<id>`), as chosen in its
 * connection-policy.json. Each route has its own relay socket beside the connector.
 */
type ManagedPolicy = {
  key: string;
  root: string;
  platform: McpConnectorPlatform | undefined;
  /** In the policy's order: the primary route first. */
  routes: Array<{ kind: McpConnectorRoute; name: string }>;
};

async function readManagedPolicy(server: ProviderMcpServer): Promise<ManagedPolicy | null> {
  const connector = server.args?.find((arg) => CMCP_CONNECTOR.test(arg));
  if (!connector) return null;
  const directory = path.dirname(connector);
  if (path.basename(directory) !== server.name) return null;
  try {
    const policy: unknown = JSON.parse(await readFile(path.join(directory, 'connection-policy.json'), 'utf8'));
    if (!policy || typeof policy !== 'object') return null;
    const { key, name, ssh, web, primary, dual } = policy as Record<string, unknown>;
    if (name !== server.name || typeof key !== 'string' || !key) return null;
    if (typeof ssh !== 'string' || typeof web !== 'string' || !CMCP_ROUTE_NAME.test(ssh) || !CMCP_ROUTE_NAME.test(web)) return null;
    if (primary !== 'url' && primary !== 'ssh') return null;
    const order: McpConnectorRoute[] = primary === 'url' ? ['web', 'ssh'] : ['ssh', 'web'];
    return {
      key,
      root: path.dirname(directory),
      platform: webPlatform(web),
      routes: order.slice(0, dual === true ? 2 : 1).map((kind) => ({ kind, name: kind === 'web' ? web : ssh })),
    };
  } catch {
    return null;
  }
}

/**
 * The router's own test: a route counts only when its relay is connected to this PC.
 * Reports the routes that are connected, or the primary route while none is.
 */
async function readManaged(policy: ManagedPolicy): Promise<ConnectionDetails> {
  let connecting = false;
  const connected: McpConnectorRoute[] = [];
  for (const route of policy.routes) {
    try {
      const live = await exchange(path.join(policy.root, route.name, 'relay', 'link.sock'), { id: 1, op: 'status' });
      if (live.ok !== true || live.connected !== true) continue;
      const machine = live.pc && typeof live.pc === 'object' ? (live.pc as { machine?: unknown }).machine : undefined;
      if (machine === policy.key) connected.push(route.kind);
      else if (!live.pc) connecting = true;
    } catch {
      // That route is offline; try the next one.
    }
  }
  const status = connected.length ? 'connected' : connecting ? 'connecting' : 'disconnected';
  return details(status, policy.platform, connected.length ? connected : [policy.routes[0].kind]);
}

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

/**
 * Used by providerMcpService; CMCP reflects PC reachability, other servers reflect the live
 * session's SDK. `runtime` is null when no Claude process runs for the session: Claude starts
 * ordinary servers with a reply, so they are reported as not started rather than disconnected.
 * CMCP entries also say which platform they reach and over which route (URL or SSH), so the
 * inspector can show "windows-web" or "windows-ssh" instead of the connector's internal name.
 */
export async function resolveMcpConnections(
  servers: ProviderMcpServer[],
  runtime: Array<{ name: string; status: string }> | null,
): Promise<McpConnectionStatus[]> {
  const relays = new Map<string, ReturnType<typeof readRelay>>();
  return Promise.all(servers.map(async (server) => {
    const managed = server.transport === 'stdio' ? await readManagedPolicy(server) : null;
    if (managed) return { name: server.name, ...(await readManaged(managed)) };
    const platform = webPlatform(server.name);
    const isCmcp = (platform || CMCP_SSH_NAME.test(server.name)) && server.transport === 'stdio'
      && server.args?.some((arg) => CMCP_CONNECTOR.test(arg));
    if (isCmcp) {
      const socketPath = server.env?.CLOUDPC_LINK_SOCKET || process.env.CLOUDPC_LINK_SOCKET
        || path.join(os.homedir(), '.local', 'share', 'cloudpc-link', 'link.sock');
      if (!relays.has(socketPath)) relays.set(socketPath, readRelay(socketPath));
      const live = await relays.get(socketPath)!;
      const status = live.status === 'connecting' ? 'connecting' : live.name === server.name ? live.status : 'disconnected';
      return { name: server.name, ...details(status, platform, [platform ? 'web' : 'ssh']) };
    }
    if (!runtime) return { name: server.name, status: 'idle' };
    const live = runtime.find((entry) => entry.name === server.name)?.status;
    return { name: server.name, status: live === 'connected' ? 'connected' : live === 'pending' ? 'connecting' : 'disconnected' };
  }));
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { WebSocket, type RawData } from 'ws';

import { cmcpBootstrap } from './cmcp-bootstrap.js';

const MAX_BOOTSTRAP_BYTES = 1536 * 1024;

/** Used by the authenticated websocket gateway; the connector runs under ClaudeWeb's own HOME. */
export function handleCmcpConnection(ws: WebSocket): void {
  let child: ChildProcessWithoutNullStreams | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadline);
    child?.stdin.destroy();
    child?.kill();
  };
  const fail = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'error', message: 'Unable to start the CMCP connector. Check Python 3.9+ and the ClaudeWeb account configuration.' }));
      ws.close(1011, 'CMCP connector unavailable');
    }
    stop();
  };
  const deadline = setTimeout(fail, 15_000);
  ws.on('close', stop);
  ws.on('error', stop);
  ws.on('message', (raw: RawData, binary: boolean) => {
    try {
      const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (stopped || binary || bytes.length > (child ? 64 * 1024 : MAX_BOOTSTRAP_BYTES)) return fail();
      const message = JSON.parse(bytes.toString());
      if (!child) {
        if (message?.t !== 'bootstrap' || !message.data || !['windows-pc-files', 'linux-pc-files', 'mac-pc-files'].includes(message.data.name)) return fail();
        const payload = JSON.stringify(message.data) + '\n';
        if (Buffer.byteLength(payload) > MAX_BOOTSTRAP_BYTES) return fail();
        clearTimeout(deadline);
        child = spawn('python3', ['-I', '-B', '-u', '-c', cmcpBootstrap], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        child.on('error', fail);
        child.stdin.on('error', fail);
        child.stdout.on('data', (data: Buffer) => {
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024 * 1024) return fail();
          ws.send(data, { binary: true });
        });
        // Installer diagnostics may contain user paths; never forward them into the protocol.
        child.stderr.resume();
        child.on('close', (code) => {
          if (!stopped && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'exit', code }));
            ws.close(1011, 'CMCP connector exited');
          }
          stop();
        });
        child.stdin.write(payload);
      } else if (message?.t === 'kill') {
        stop();
        ws.close();
      } else if (message?.t === 'i' && typeof message.d === 'string' && message.d.startsWith('CPCMCP1:') && !child.stdin.destroyed) {
        if (child.stdin.writableLength > 1024 * 1024) return fail();
        child.stdin.write(message.d);
      } else fail();
    } catch { fail(); }
  });
}

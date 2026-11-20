import fs from 'node:fs/promises';
import http from 'node:http';

import { WebSocket } from 'ws';

import { AppError } from '@/shared/utils.js';

const SID = /^[a-f0-9]{24,64}$/;
const MAX_REPLY_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
// Frames for a page that reads slowly wait here; past HIGH the gateway side is paused.
const HIGH = 4 * 1024 * 1024;
const LOW = 1024 * 1024;
const MAX_PENDING = 64;
// Headers of a gateway reply that are passed on to the page; nothing else is.
const REPLY_HEADERS = ['content-type', 'x-image-width', 'x-image-height'];

export type BrowserReply = { status: number; headers: Record<string, string>; body: Buffer };

type Dependencies = {
  /** WebDesktop's gateway socket for ClaudeWeb (CLAUDEWEB_GUI_SOCKET); unset outside WebDesktop. */
  socketPath: string | undefined;
};

function requireSid(sid: unknown): string {
  if (typeof sid !== 'string' || !SID.test(sid)) {
    throw new AppError('A browser session id is required.', { code: 'INVALID_REQUEST', statusCode: 400 });
  }
  return sid;
}

/** Close codes the page may receive or send as they are; the rest map to a plain close. */
function sendableCode(code: number): boolean {
  return code === 1000 || code === 1001 || code === 1008 || code === 1013 || (code >= 3000 && code <= 4999);
}

/**
 * Created by the browser module: ClaudeWeb's side of the browser panel. The desktop's own
 * Chromium runs under WebDesktop's gateway, which offers it to ClaudeWeb on a local socket;
 * this relays the page's picture connection and its status, clipboard and close requests
 * there. The gateway decides everything (ownership, limits, takeover); this only forwards.
 */
export function createBrowserService({ socketPath }: Dependencies) {
  async function available(): Promise<boolean> {
    if (!socketPath) return false;
    try {
      return (await fs.stat(socketPath)).isSocket();
    } catch {
      return false;
    }
  }

  async function forward(method: string, path: string, body?: Buffer, contentType?: string): Promise<BrowserReply> {
    if (!(await available())) {
      throw new AppError('The browser needs WebDesktop 3.0.3 or newer.', { code: 'BROWSER_UNAVAILABLE', statusCode: 503 });
    }
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath, method, path, timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Content-Length': String(body?.length ?? 0), ...(contentType ? { 'Content-Type': contentType } : {}) },
      }, (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_REPLY_BYTES) request.destroy(new Error('reply too large'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          const headers: Record<string, string> = {};
          for (const name of REPLY_HEADERS) {
            const value = response.headers[name];
            if (typeof value === 'string') headers[name] = value;
          }
          resolve({ status: response.statusCode ?? 502, headers, body: Buffer.concat(chunks) });
        });
        response.on('error', reject);
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', () => reject(new AppError('The browser did not answer.', { code: 'UNAVAILABLE', statusCode: 503 })));
      request.end(body);
    });
  }

  return {
    available,

    status(sid: unknown) {
      return forward('GET', '/api/gui/status?sid=' + requireSid(sid));
    },

    /** Text clipboard: `{ sid, op, text? }` exactly as WebDesktop's own browser window sends it. */
    text(body: unknown) {
      return forward('POST', '/api/gui/text-clipboard', Buffer.from(JSON.stringify(body ?? {})), 'application/json');
    },

    /** PNG image clipboard; the gateway checks the image. */
    image(sid: unknown, op: unknown, data?: Buffer) {
      if (op !== 'read' && op !== 'write') {
        throw new AppError('Unknown image clipboard operation.', { code: 'INVALID_REQUEST', statusCode: 400 });
      }
      const path = '/api/gui/image-clipboard?sid=' + requireSid(sid) + '&op=' + op;
      return op === 'write' ? forward('POST', path, data ?? Buffer.alloc(0), 'image/png') : forward('POST', path);
    },

    /** Ends the browser (the user closed the panel's browser). */
    end(sid: unknown) {
      return forward('POST', '/api/gui/end', Buffer.from(JSON.stringify({ sid: requireSid(sid) })), 'application/json');
    },

    /**
     * Connects one page connection to the gateway's browser. Close codes pass through both
     * ways: a clean close from the page ends the browser, a dropped connection keeps it for
     * the page to come back to, and the gateway's "moved to the desktop" reaches the page.
     */
    relay(client: WebSocket, url: URL) {
      const sid = url.searchParams.get('sid') ?? '';
      const width = Number(url.searchParams.get('w')), height = Number(url.searchParams.get('h'));
      if (!SID.test(sid) || !Number.isInteger(width) || !Number.isInteger(height) || !socketPath) {
        client.close(4400, 'Invalid browser request');
        return;
      }
      const upstream = new WebSocket(`ws+unix://${socketPath}:/api/gui/ws?sid=${sid}&app=chromium&w=${width}&h=${height}`,
        { perMessageDeflate: false, maxPayload: 1024 * 1024 });
      const pending: Buffer[] = [];
      let paused = false;
      const flow = setInterval(() => {
        if (paused && client.bufferedAmount < LOW) { paused = false; upstream.resume(); }
      }, 50);
      flow.unref?.();

      client.on('message', (data, isBinary) => {
        if (!isBinary) { client.close(1008, 'Binary frames only'); return; }
        const bytes = data as Buffer;
        if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: true });
        else if (upstream.readyState === WebSocket.CONNECTING && pending.length < MAX_PENDING) pending.push(bytes);
        else client.close(1013, 'Browser not ready');
      });
      upstream.on('open', () => {
        for (const bytes of pending) upstream.send(bytes, { binary: true });
        pending.length = 0;
      });
      upstream.on('message', (data) => {
        if (client.readyState !== WebSocket.OPEN) return;
        client.send(data as Buffer, { binary: true });
        if (!paused && client.bufferedAmount > HIGH) { paused = true; upstream.pause(); }
      });
      upstream.on('unexpected-response', (_request, response) => {
        if (client.readyState === WebSocket.OPEN) client.close(response.statusCode === 400 ? 4400 : 4503, 'Browser unavailable');
        upstream.terminate();
      });
      upstream.on('close', (code) => {
        clearInterval(flow);
        if (client.readyState !== WebSocket.OPEN) return;
        if (sendableCode(code)) client.close(code);
        else client.terminate();
      });
      upstream.on('error', () => {
        if (client.readyState === WebSocket.OPEN) client.close(4502, 'Browser connection failed');
      });
      client.on('close', (code) => {
        clearInterval(flow);
        if (upstream.readyState === WebSocket.OPEN) {
          // 1005 (no code) is also a deliberate close; an abnormal drop is passed on as one.
          if (code === 1005) upstream.close(1000);
          else if (sendableCode(code)) upstream.close(code);
          else upstream.terminate();
        } else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      });
      client.on('error', () => upstream.terminate());
    },
  };
}

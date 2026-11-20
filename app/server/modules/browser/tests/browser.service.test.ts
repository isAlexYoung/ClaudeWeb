import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { WebSocket, WebSocketServer } from 'ws';

import { createBrowserService } from '../browser.service.js';

const linux = process.platform === 'linux';
const SID = 'a'.repeat(24);

/** A stand-in for WebDesktop's gateway entrance on a unix socket, recording what reaches it. */
async function fakeGateway() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeweb-browser-'));
  const socketPath = path.join(directory, 'gateway.sock');
  const seen: Array<{ method: string; url: string; type?: string; body: string }> = [];
  const upgrades: string[] = [];
  const closes: number[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', type: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') });
      if (req.url?.startsWith('/api/gui/image-clipboard') && req.url.endsWith('op=read')) {
        res.writeHead(200, { 'Content-Type': 'image/png', 'X-Image-Width': '2', 'X-Image-Height': '3', 'Set-Cookie': 'leak=1' });
        res.end(Buffer.from([0x89, 0x50]));
        return;
      }
      res.writeHead(req.url?.startsWith('/api/gui/status') ? 200 : 409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: req.url?.startsWith('/api/gui/status') ? undefined : 'GUI_INACTIVE', state: 'open' }));
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    upgrades.push(req.url ?? '');
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(Buffer.from('RFB 003.008\n'));
      ws.on('message', (data) => {
        if (String(data) === 'move') ws.close(4409);
        else ws.send(data as Buffer, { binary: true });
      });
      ws.on('close', (code) => closes.push(code));
    });
  });
  server.listen(socketPath);
  await once(server, 'listening');
  return {
    socketPath, seen, upgrades, closes,
    async close() { wss.close(); await new Promise((resolve) => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); },
  };
}

/** The page side: a real websocket to a relay endpoint served the way ClaudeWeb's gateway does. */
async function pageConnection(service: ReturnType<typeof createBrowserService>, query: string) {
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => service.relay(ws, new URL(req.url ?? '/', 'http://localhost')));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const page = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/browser-ws?${query}`);
  const received: string[] = [];
  page.on('message', (data) => received.push(String(data)));
  const closed = new Promise<number>((resolve) => page.on('close', (code) => resolve(code)));
  page.on('error', () => {});
  return { page, received, closed, async done() { wss.close(); await new Promise((resolve) => server.close(resolve)); } };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 300 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(check(), 'condition not reached');
};

test('without WebDesktop the browser is reported unavailable instead of failing obscurely', async () => {
  const service = createBrowserService({ socketPath: undefined });
  assert.equal(await service.available(), false);
  await assert.rejects(service.status(SID), { code: 'BROWSER_UNAVAILABLE' });
  await assert.rejects(createBrowserService({ socketPath: '/nonexistent/gateway.sock' }).end(SID), { code: 'BROWSER_UNAVAILABLE' });
});

test('status, clipboard and close requests are forwarded unchanged; only safe reply headers come back', { skip: !linux }, async () => {
  const gateway = await fakeGateway();
  try {
    const service = createBrowserService({ socketPath: gateway.socketPath });
    assert.equal(await service.available(), true);
    assert.equal((await service.status(SID)).status, 200);
    const copied = await service.text({ sid: SID, op: 'copy' });
    assert.equal(copied.status, 409);
    const image = await service.image(SID, 'read');
    assert.deepEqual(image.headers, { 'content-type': 'image/png', 'x-image-width': '2', 'x-image-height': '3' });
    await service.image(SID, 'write', Buffer.from([1, 2, 3]));
    await service.end(SID);
    assert.deepEqual(gateway.seen.map(({ method, url, type }) => [method, url, type]), [
      ['GET', '/api/gui/status?sid=' + SID, undefined],
      ['POST', '/api/gui/text-clipboard', 'application/json'],
      ['POST', '/api/gui/image-clipboard?sid=' + SID + '&op=read', undefined],
      ['POST', '/api/gui/image-clipboard?sid=' + SID + '&op=write', 'image/png'],
      ['POST', '/api/gui/end', 'application/json'],
    ]);
    assert.deepEqual(JSON.parse(gateway.seen[1].body), { sid: SID, op: 'copy' });
    assert.throws(() => service.status('../etc'), { code: 'INVALID_REQUEST' });
    assert.throws(() => service.image(SID, 'delete'), { code: 'INVALID_REQUEST' });
  } finally { await gateway.close(); }
});

test('the picture passes both ways and the gateway only ever sees the browser app', { skip: !linux }, async () => {
  const gateway = await fakeGateway();
  try {
    const service = createBrowserService({ socketPath: gateway.socketPath });
    const connection = await pageConnection(service, `sid=${SID}&w=800&h=600&app=pcmanfm`);
    await until(() => connection.received.length > 0);
    assert.equal(connection.received[0], 'RFB 003.008\n');
    assert.deepEqual(gateway.upgrades, [`/api/gui/ws?sid=${SID}&app=chromium&w=800&h=600`]);
    connection.page.send(Buffer.from('key'), { binary: true });
    await until(() => connection.received.includes('key'));
    // A clean close from the page ends the browser on the gateway.
    connection.page.close(1000);
    await until(() => gateway.closes.length === 1);
    assert.deepEqual(gateway.closes, [1000]);
    await connection.done();
  } finally { await gateway.close(); }
});

test('a dropped page keeps the browser, and "moved to the desktop" reaches the page', { skip: !linux }, async () => {
  const gateway = await fakeGateway();
  try {
    const service = createBrowserService({ socketPath: gateway.socketPath });
    const dropped = await pageConnection(service, `sid=${SID}&w=800&h=600`);
    await until(() => dropped.received.length > 0);
    dropped.page.terminate();
    await until(() => gateway.closes.length === 1);
    assert.equal(gateway.closes[0], 1006, 'an abnormal drop, which the gateway keeps for a reconnect');
    await dropped.done();

    const moved = await pageConnection(service, `sid=${SID}&w=800&h=600`);
    await until(() => moved.received.length > 0);
    moved.page.send(Buffer.from('move'), { binary: true });
    assert.equal(await moved.closed, 4409);
    await moved.done();

    const invalid = await pageConnection(service, 'sid=nope&w=800&h=600');
    assert.equal(await invalid.closed, 4400);
    await invalid.done();
  } finally { await gateway.close(); }
});

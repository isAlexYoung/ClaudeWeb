import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createGraphicalSessionService } from '@/modules/graphical-session/index.js';
import { AppError } from '@/shared/utils.js';

import { createBrowserService } from '../browser.service.js';

const SID = 'a'.repeat(24);

function service(chromiumPath?: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeweb-browser-'));
  return { home, browser: createBrowserService({ homeDirectory: home, chromiumPath }) };
}

/** A stand-in for a panel WebSocket: records how it was closed. */
function fakeClient() {
  const client = new EventEmitter() as EventEmitter & { readyState: number; closed: { code: number; reason: string } | null; close(code: number, reason: string): void; send(): void };
  client.readyState = 1;
  client.closed = null;
  client.close = (code, reason) => { client.closed = { code, reason }; client.readyState = 3; };
  client.send = () => undefined;
  return client;
}

test('without Chromium the browser is reported unavailable', async () => {
  const { home, browser } = service();
  assert.equal(await browser.available(), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('a named Chromium that does not exist does not count as installed', async () => {
  const { home, browser } = service('/nonexistent/chrome');
  assert.equal(await browser.available(), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('status of a panel that never started a browser says none', async () => {
  const { home, browser } = service();
  const reply = await browser.status(SID);
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body.toString('utf8')), { state: 'none' });
  fs.rmSync(home, { recursive: true, force: true });
});

test('requests need a valid session id', async () => {
  const { home, browser } = service();
  await assert.rejects(browser.status('not-hex'), (error: unknown) => error instanceof AppError && error.code === 'INVALID_REQUEST');
  await assert.rejects(browser.end('x'), (error: unknown) => error instanceof AppError && error.code === 'INVALID_REQUEST');
  fs.rmSync(home, { recursive: true, force: true });
});

test('clipboard requests without a running browser are refused', async () => {
  const { home, browser } = service();
  await assert.rejects(browser.text({ sid: SID, op: 'read' }), (error: unknown) => error instanceof AppError && error.code === 'GUI_INACTIVE');
  await assert.rejects(browser.image(SID, 'read'), (error: unknown) => error instanceof AppError && error.code === 'GUI_INACTIVE');
  fs.rmSync(home, { recursive: true, force: true });
});

test('ending a panel that has no browser is harmless', async () => {
  const { home, browser } = service();
  const reply = await browser.end(SID);
  assert.deepEqual(JSON.parse(reply.body.toString('utf8')), { ok: true });
  fs.rmSync(home, { recursive: true, force: true });
});

test('a picture connection with a bad request is closed with 4400; without Chromium with 4503', async () => {
  const { home, browser } = service();
  const bad = fakeClient();
  browser.relay(bad as never, new URL(`http://x/browser-ws?sid=zz&w=800&h=600`));
  assert.deepEqual(bad.closed, { code: 4400, reason: 'Invalid browser request' });

  const missing = fakeClient();
  browser.relay(missing as never, new URL(`http://x/browser-ws?sid=${SID}&w=800&h=600`));
  for (let i = 0; i < 50 && !missing.closed; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(missing.closed, { code: 4503, reason: 'Browser unavailable' });
  fs.rmSync(home, { recursive: true, force: true });
});

test('opening a link accepts only http(s) addresses', async () => {
  const { home, browser } = service();
  for (const url of [undefined, 42, '', 'javascript:alert(1)', 'file:///etc/passwd', 'chrome://settings', `https://example.com/${'a'.repeat(2100)}`]) {
    await assert.rejects(browser.open(url), (error: unknown) => error instanceof AppError && error.code === 'INVALID_URL', String(url).slice(0, 40));
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test('a link asked for before the browser runs waits to be its first page', async () => {
  const { home, browser } = service();
  const reply = await browser.open('https://claude.ai/customize/connectors');
  assert.equal(reply.status, 200);
  assert.deepEqual(JSON.parse(reply.body.toString('utf8')), { ok: true, opened: 'pending' });
  fs.rmSync(home, { recursive: true, force: true });
});

test('Claude Desktop does not open links', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeweb-desktop-'));
  const desktop = createGraphicalSessionService({ homeDirectory: home, application: 'claude-desktop' });
  await assert.rejects(desktop.open('https://example.com'), (error: unknown) => error instanceof AppError && error.code === 'INVALID_REQUEST');
  fs.rmSync(home, { recursive: true, force: true });
});

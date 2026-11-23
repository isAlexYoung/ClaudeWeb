import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '@/shared/utils.js';

import { createAuthRouter } from '../auth.routes.js';

type Service = Parameters<typeof createAuthRouter>[0];

async function withAuthServer(service: Partial<Service>, run: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  const authenticate = (req: Request, _res: Response, next: NextFunction) => {
    Object.assign(req, { user: { id: 1, username: 'claudeweb' }, authSessionId: 'session-9' });
    next();
  };
  app.use('/api/auth', createAuthRouter(service as Service, authenticate));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const appError = error as AppError;
    res.status(appError.statusCode ?? 500).json({ error: { code: appError.code, details: appError.details } });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('CMCP discovery advertises the URL tool bridge and session-code uses the authenticated session', async () => {
  let seen = '';
  await withAuthServer({ createCmcpSessionCode: (sessionId) => { seen = sessionId; return { code: 'browser-code', expiresInSeconds: 120 }; } }, async (baseUrl) => {
    const info = await (await fetch(`${baseUrl}/api/auth/cmcp`)).json();
    assert.deepEqual(info, { protocol: 'claudeweb-cmcp', version: 1, capabilities: { webMcp: 1 } });
    assert.deepEqual(await (await post(`${baseUrl}/api/auth/cmcp/session-code`, {})).json(), { code: 'browser-code', expiresInSeconds: 120 });
  });
  assert.equal(seen, 'session-9');
});

test('login counts attempts against the Cloudflare visitor IP on a local connection', async () => {
  const seen: Array<{ password: unknown; ip: string; userAgent: string | null }> = [];
  await withAuthServer({
    login: async (input) => {
      seen.push(input);
      return { success: true, user: { id: 1, username: 'claudeweb' }, token: 't' };
    },
  }, async (baseUrl) => {
    await post(`${baseUrl}/api/auth/login`, { password: 'pw' }, { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Agent/1' });
    await post(`${baseUrl}/api/auth/login`, { password: 'pw' }, { 'cf-connecting-ip': 'not-an-ip' });
  });

  assert.deepEqual(seen[0], { password: 'pw', ip: '203.0.113.9', userAgent: 'Agent/1', mode: undefined, replace: undefined });
  assert.equal(seen[1].ip, '127.0.0.1', 'a header that is not an IP address is ignored');
});

test('a locked IP gets 429 with Retry-After', async () => {
  await withAuthServer({
    login: async () => {
      throw new AppError('locked', { code: 'AUTH_LOCKED', statusCode: 429, details: { retryAfterSeconds: 42 } });
    },
  }, async (baseUrl) => {
    const response = await post(`${baseUrl}/api/auth/login`, { password: 'pw' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '42');
    assert.deepEqual(await response.json(), { error: { code: 'AUTH_LOCKED', details: { retryAfterSeconds: 42 } } });
  });
});

test('logout and refresh act on the session the token belongs to; register no longer exists', async () => {
  const calls: string[] = [];
  await withAuthServer({
    logout: (sessionId) => { calls.push(`logout:${sessionId}`); return { success: true }; },
    refreshToken: (_user, sessionId) => { calls.push(`refresh:${sessionId}`); return { token: 'fresh' }; },
  }, async (baseUrl) => {
    assert.deepEqual(await (await post(`${baseUrl}/api/auth/refresh`, {})).json(), { token: 'fresh' });
    assert.deepEqual(await (await post(`${baseUrl}/api/auth/logout`, {})).json(), { success: true });
    assert.equal((await post(`${baseUrl}/api/auth/register`, { username: 'x', password: 'y' })).status, 404);
  });
  assert.deepEqual(calls, ['refresh:session-9', 'logout:session-9']);
});

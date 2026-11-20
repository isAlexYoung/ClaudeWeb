import net from 'node:net';

import express from 'express';
import type { RequestHandler } from 'express';

import { AppError } from '@/shared/utils.js';

import type { createAuthService } from './auth.service.js';

type RouteUser = { id: number; username: string };
type AuthenticatedRequest = express.Request & { user?: RouteUser; authSessionId?: string };

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);

function normalizeAddress(address: string | undefined): string {
  return address?.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address ?? '';
}

/**
 * The address failed logins are counted against. ClaudeWeb listens on
 * localhost, so every connection arrives from 127.0.0.1: through an SSH tunnel
 * (counted as one source) or through cloudflared, whose CF-Connecting-IP header
 * Cloudflare sets to the real visitor. That header is believed only on a
 * loopback connection; someone who can already open one is on the server.
 */
function resolveClientIp(req: express.Request): string {
  const peer = normalizeAddress(req.socket.remoteAddress);
  if (LOOPBACK_ADDRESSES.has(peer)) {
    const forwarded = req.get('cf-connecting-ip')?.trim();
    if (forwarded && net.isIP(forwarded)) return normalizeAddress(forwarded);
  }
  return peer || 'unknown';
}

/**
 * Creates the Auth transport adapter. Handlers only parse request data and
 * delegate authentication behavior to the injected application service.
 */
export function createAuthRouter(
  service: ReturnType<typeof createAuthService<RouteUser>>,
  authenticateToken: RequestHandler,
): express.Router {
  const router = express.Router();

  router.get('/status', (_req, res, next) => {
    try {
      res.json(service.getStatus());
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as { password?: unknown };
      res.json(await service.login({
        password: body.password,
        ip: resolveClientIp(req),
        userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
      }));
    } catch (error) {
      if (error instanceof AppError && error.code === 'AUTH_LOCKED') {
        const seconds = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        if (seconds) res.setHeader('Retry-After', String(seconds));
      }
      next(error);
    }
  });

  router.get('/user', authenticateToken, (req, res) => {
    res.json({ user: (req as AuthenticatedRequest).user });
  });

  router.post('/refresh', authenticateToken, (req, res) => {
    const authenticated = req as AuthenticatedRequest;
    res.json(service.refreshToken(authenticated.user as RouteUser, authenticated.authSessionId as string));
  });

  router.post('/logout', authenticateToken, (req, res) => {
    res.json(service.logout((req as AuthenticatedRequest).authSessionId as string));
  });

  return router;
}

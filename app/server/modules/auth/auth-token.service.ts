import { createRequire } from 'node:module';

import { appConfigDb } from '@/modules/database/index.js';

type JwtAdapter = {
  sign(payload: object, secret: string, options: { expiresIn: string }): string;
  verify(token: string, secret: string): unknown;
  TokenExpiredError: new (...args: never[]) => Error;
};

// jsonwebtoken ships no TypeScript declarations in this project, so its
// CommonJS surface is narrowed here, as the Auth module does for bcrypt.
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken') as JwtAdapter;

const TOKEN_LIFETIME = '7d';

type SessionTokenClaims = {
  userId: number;
  username: string;
  /** The login session (signed-in device) the token belongs to. */
  sid: string;
};

let signingSecret: string | null = null;

// Read lazily: the database may not be initialized when this module loads.
function getSigningSecret(): string {
  signingSecret ??= process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();
  return signingSecret;
}

/** Used by the Auth module to issue a browser's token after login or refresh. */
export function signSessionToken(claims: SessionTokenClaims): string {
  return jwt.sign(claims, getSigningSecret(), { expiresIn: TOKEN_LIFETIME });
}

/**
 * Used by the Auth module's HTTP and WebSocket checks. Returns the claims of a
 * valid token, or why it was refused. Tokens from before login sessions
 * existed carry no `sid` and count as invalid.
 */
export function readSessionToken(token: string):
  | { claims: SessionTokenClaims; issuedAt: number; expiresAt: number }
  | { error: 'expired' | 'invalid' } {
  try {
    const decoded = jwt.verify(token, getSigningSecret()) as Partial<SessionTokenClaims> & { iat?: number; exp?: number };
    if (typeof decoded.sid !== 'string' || typeof decoded.username !== 'string'
      || typeof decoded.userId !== 'number' || typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
      return { error: 'invalid' };
    }
    return {
      claims: { userId: decoded.userId, username: decoded.username, sid: decoded.sid },
      issuedAt: decoded.iat,
      expiresAt: decoded.exp,
    };
  } catch (error) {
    return { error: error instanceof jwt.TokenExpiredError ? 'expired' : 'invalid' };
  }
}

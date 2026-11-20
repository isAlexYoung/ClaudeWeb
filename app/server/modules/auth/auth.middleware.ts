import type { NextFunction, Request, RequestHandler, Response } from 'express';

type TokenCheck<User> =
  | { user: User; sessionId: string; refreshedToken: string | null }
  | { error: 'expired' | 'invalid' };

/**
 * Request after `authenticateToken`: the signed-in user and the login session
 * (device) the token belongs to. Used by the Auth routes for refresh and logout.
 */
type AuthenticatedRequest<User> = Request & { user?: User; authSessionId?: string };

/** Optional API-wide key, enabled only when API_KEY is set in the environment. */
export const validateApiKey: RequestHandler = (req, res, next) => {
  if (!process.env.API_KEY) {
    return next();
  }
  if (req.headers['x-api-key'] !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

/**
 * Used by the Auth module to build the HTTP guard every protected router uses.
 * The token comes from `Authorization: Bearer`, or from `?token=` for
 * EventSource, which cannot set headers.
 */
export function createAuthenticateToken<User>(checkToken: (token: string) => TokenCheck<User>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const token = (header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '') || queryToken;

    const result = token ? checkToken(token) : { error: 'invalid' as const };
    if ('error' in result) {
      const expired = result.error === 'expired';
      res.setHeader('X-Auth-Error', expired ? 'session-expired' : 'invalid-token');
      return res.status(401).json({
        error: expired ? 'Session expired. Please log in again.' : 'Please log in.',
        code: expired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
      });
    }

    if (result.refreshedToken) {
      res.setHeader('X-Refreshed-Token', result.refreshedToken);
    }
    const authenticated = req as AuthenticatedRequest<User>;
    authenticated.user = result.user;
    authenticated.authSessionId = result.sessionId;
    next();
  };
}

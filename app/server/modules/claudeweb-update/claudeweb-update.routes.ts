import express from 'express';

import type { createClaudeWebUpdateService } from '@/modules/claudeweb-update/claudeweb-update.service.js';

type ClaudeWebUpdateService = ReturnType<typeof createClaudeWebUpdateService>;

function respond(operation: (req: express.Request) => unknown | Promise<unknown>) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      res.json(await operation(req));
    } catch (error) {
      next(error);
    }
  };
}

/** Used by the claudeweb-update module to mount Settings > About's update API under `/api/claudeweb-update`. */
export function createClaudeWebUpdateRouter(service: ClaudeWebUpdateService): express.Router {
  const router = express.Router();
  router.get('/status', respond(() => service.status()));
  router.post('/check', respond(() => service.check()));
  router.post('/update', respond((req) => service.update(req.body?.version)));
  return router;
}

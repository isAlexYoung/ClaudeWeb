import express from 'express';

import type { createSudoService } from './sudo.service.js';

/**
 * The pages' side of sudo confirmation: the requests waiting for the user, and
 * the answer. The password arrives in the answer's body, goes straight to
 * sudo and is never logged or kept.
 */
export function createSudoRouter(service: () => ReturnType<typeof createSudoService> | null): express.Router {
  const router = express.Router();

  router.get('/requests', (_req, res) => {
    res.json({ available: service() !== null, requests: service()?.list() ?? [] });
  });

  router.post('/requests/:id', (req, res, next) => {
    try {
      const active = service();
      if (!active) {
        res.status(404).json({ error: 'sudo confirmation is not available here', code: 'SUDO_UNAVAILABLE' });
        return;
      }
      const body = (req.body ?? {}) as { approve?: unknown; password?: unknown };
      res.json(active.answer(req.params.id, { approve: body.approve, password: body.password }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

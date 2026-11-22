import express from 'express';

import type { createBrowserService } from '@/modules/browser/browser.service.js';
import type { GraphicalReply } from '@/shared/types.js';

type BrowserService = ReturnType<typeof createBrowserService>;

function reply(operation: (req: express.Request) => Promise<GraphicalReply>) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const result = await operation(req);
      res.status(result.status).set({ ...result.headers, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(result.body);
    } catch (error) {
      next(error);
    }
  };
}

/** Used by the browser module to mount the browser panel's requests under `/api/browser`. */
export function createBrowserRouter(service: BrowserService): express.Router {
  const router = express.Router();
  router.get('/available', async (_req, res) => { res.json({ available: await service.available() }); });
  router.get('/status', reply((req) => service.status(req.query.sid)));
  router.post('/text-clipboard', reply((req) => service.text(req.body)));
  router.post('/image-clipboard', express.raw({ type: 'image/png', limit: 1024 * 1024 }),
    reply((req) => service.image(req.query.sid, req.query.op, Buffer.isBuffer(req.body) ? req.body : undefined)));
  router.post('/end', reply((req) => service.end(req.body?.sid)));
  return router;
}

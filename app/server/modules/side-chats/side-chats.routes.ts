import express from 'express';
import type { createSideChatsService } from '@/modules/side-chats/side-chats.service.js';
import { AppError } from '@/shared/utils.js';

/** Used by the composition root; authenticates ownership before calling a service workflow. */
export function createSideChatsRouter(service: ReturnType<typeof createSideChatsService>) {
  const router = express.Router();
  router.use((req, _res, next) => {
    const id = Number((req as express.Request & { user?: { id: number } }).user?.id);
    if (!Number.isSafeInteger(id) || id <= 0) return next(new AppError('Authentication required', { code: 'UNAUTHORIZED', statusCode: 401 }));
    next();
  });
  const user = (req: express.Request) => Number((req as express.Request & { user: { id: number } }).user.id);
  const body = (req: express.Request) => req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  router.get('/', (req, res, next) => { try { res.json(service.list(user(req), String(req.query.parentSessionId || ''))); } catch (e) { next(e); } });
  router.post('/', (req, res, next) => { try { res.status(201).json(service.create(user(req), body(req))); } catch (e) { next(e); } });
  router.patch('/:id', (req, res, next) => { try { res.json(service.update(user(req), String(req.params.id), body(req))); } catch (e) { next(e); } });
  router.delete('/:id', (req, res, next) => { try { service.remove(user(req), String(req.params.id)); res.json({ deleted: true }); } catch (e) { next(e); } });
  router.post('/:id/messages', (req, res, next) => { try { res.status(202).json(service.send(user(req), String(req.params.id), body(req).content)); } catch (e) { next(e); } });
  router.post('/:id/stop', (req, res, next) => { try { res.json(service.stop(user(req), String(req.params.id))); } catch (e) { next(e); } });
  return router;
}

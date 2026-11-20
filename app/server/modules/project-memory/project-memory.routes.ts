import express from 'express';

import type { createProjectMemoryService } from '@/modules/project-memory/project-memory.service.js';
import { AppError, asyncHandler } from '@/shared/utils.js';

/** Used by the authenticated composition root to expose project memory operations. */
export function createProjectMemoryRouter(service: ReturnType<typeof createProjectMemoryService>) {
  const router = express.Router();
  router.use((req, _res, next) => {
    if (!Number.isSafeInteger(Number((req as express.Request & { user?: { id: number } }).user?.id)) || Number((req as express.Request & { user?: { id: number } }).user?.id) <= 0) return next(new AppError('Authentication required', { code: 'UNAUTHORIZED', statusCode: 401 }));
    next();
  });
  const body = (req: express.Request) => req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body as Record<string, unknown> : {};
  router.get('/:projectId', asyncHandler(async (req, res) => { res.json(await service.list(String(req.params.projectId))); }));
  router.post('/:projectId', asyncHandler(async (req, res) => { res.status(201).json(await service.create(String(req.params.projectId), body(req))); }));
  router.patch('/:projectId/:id', asyncHandler(async (req, res) => { res.json(await service.update(String(req.params.projectId), String(req.params.id), body(req))); }));
  router.delete('/:projectId/:id', asyncHandler(async (req, res) => { res.json(await service.remove(String(req.params.projectId), String(req.params.id), body(req).version)); }));
  return router;
}

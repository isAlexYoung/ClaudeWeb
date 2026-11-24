import express from 'express';
import type { Request, Response } from 'express';

import { artefactsService } from '@/modules/artefacts/services/artefacts.service.js';
import { AppError, asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

type AuthenticatedRequest = Request & { user?: { id?: number | string } };

function readUserId(request: Request): number {
  const userId = Number((request as AuthenticatedRequest).user?.id);
  if (!Number.isInteger(userId)) {
    throw new AppError('Authenticated user is required.', { code: 'USER_REQUIRED', statusCode: 401 });
  }
  return userId;
}

function readId(request: Request): string {
  const id = request.params.id;
  if (typeof id !== 'string' || !id.trim()) {
    throw new AppError('id is required.', { code: 'INVALID_REQUEST_BODY', statusCode: 400 });
  }
  return id;
}

const readBody = (request: Request) => (request.body ?? {}) as Record<string, unknown>;

const router = express.Router();

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(artefactsService.list(readUserId(req))));
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(createApiSuccessResponse(artefactsService.create(readUserId(req), readBody(req))));
}));

router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(artefactsService.open(readUserId(req), readId(req))));
}));

router.put('/:id/content', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(artefactsService.saveContent(readUserId(req), readId(req), readBody(req))));
}));

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(artefactsService.update(readUserId(req), readId(req), readBody(req))));
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  artefactsService.remove(readUserId(req), readId(req));
  res.json(createApiSuccessResponse({ deleted: true }));
}));

router.get('/:id/state', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(artefactsService.state(readUserId(req), readId(req))));
}));

router.post('/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  res.status(202).json(createApiSuccessResponse(artefactsService.sendMessage(readUserId(req), readId(req), readBody(req))));
}));

export default router;

import express from 'express';
import type { Request, Response } from 'express';

import { runScheduledTaskNow } from '@/modules/scheduled-tasks/services/scheduled-task-dispatcher.service.js';
import { scheduledTasksService } from '@/modules/scheduled-tasks/services/scheduled-tasks.service.js';
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
  res.json(createApiSuccessResponse(scheduledTasksService.list(readUserId(req))));
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(createApiSuccessResponse(scheduledTasksService.create(readUserId(req), readBody(req))));
}));

router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  res.json(createApiSuccessResponse(scheduledTasksService.update(readUserId(req), readId(req), readBody(req))));
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  scheduledTasksService.remove(readUserId(req), readId(req));
  res.json(createApiSuccessResponse({ deleted: true }));
}));

router.post('/:id/run', asyncHandler(async (req: Request, res: Response) => {
  res.status(202).json(createApiSuccessResponse(runScheduledTaskNow(readUserId(req), readId(req))));
}));

export default router;

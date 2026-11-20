import express from 'express';

import { BACKUP_CHUNK_BYTES, type createBackupService } from '@/modules/backup/backup.service.js';

type BackupService = ReturnType<typeof createBackupService>;
type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

function param(req: express.Request, name: string): string {
  const value = req.params[name];
  return typeof value === 'string' ? value : '';
}

function respond(operation: (req: express.Request) => unknown | Promise<unknown>) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      res.json(await operation(req));
    } catch (error) {
      next(error);
    }
  };
}

/** Used by the Backup module to mount the authenticated export and import API under `/api/backup`. */
export function createBackupRouter(service: BackupService): express.Router {
  const router = express.Router();

  router.post('/exports', respond((req) => service.prepareExport(userId(req), req.body?.password)));
  router.post('/imports', respond((req) => service.createImport(userId(req), { size: req.body?.size })));
  router.put(
    '/imports/:importId/chunks/:index',
    // Upload pieces are raw bytes; the global JSON parser leaves this content type alone.
    express.raw({ type: 'application/octet-stream', limit: BACKUP_CHUNK_BYTES }),
    respond((req) => service.writeImportChunk(userId(req), param(req, 'importId'), Number(param(req, 'index')), req.body)),
  );
  router.get('/imports/:importId', respond((req) => service.getImport(userId(req), param(req, 'importId'))));
  router.post('/imports/:importId/preview', respond((req) => service.startPreview(
    userId(req), param(req, 'importId'), req.body?.password,
  )));
  router.post('/imports/:importId/apply', respond((req) => service.startApply(
    userId(req), param(req, 'importId'), req.body?.projects,
  )));
  router.delete('/imports/:importId', respond((req) => service.cancelImport(userId(req), param(req, 'importId'))));
  return router;
}

/**
 * Used by the Backup module to mount the one-time download under
 * `/api/backup-download`. A browser download cannot carry the bearer token,
 * so the single-use id from `POST /api/backup/exports` is the authorization.
 */
export function createBackupDownloadRouter(service: BackupService): express.Router {
  const router = express.Router();
  router.get('/:downloadId', (req, res, next) => {
    let ticket;
    try {
      ticket = service.takeExportTicket(param(req, 'downloadId'));
    } catch (error) {
      next(error);
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${ticket.fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    service.writeExport(ticket, res).catch((error: unknown) => {
      console.error('[Backup] Export failed', error);
      res.destroy();
    });
  });
  return router;
}

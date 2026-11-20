import express from 'express';
import multer from 'multer';

import {
  buildStoredAttachmentRecords,
  buildStoredImageRecords,
  ensureImageAssetsDir,
  isAllowedImageMimeType,
  openStoredAttachmentAsset,
  recordLegacyAttachments,
} from '@/modules/assets/services/image-assets.service.js';
import {
  ATTACHMENT_CHUNK_BYTES,
  chunkedUploadService,
} from '@/modules/assets/services/chunked-upload.service.js';
import { contentDispositionFor, projectFilesService } from '@/modules/assets/services/project-files.service.js';

const router = express.Router();

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

// Multer writes uploads straight into the global assets folder; the service
// owns the folder location and the response record shape.
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureImageAssetsDir()
      .then((assetsDir) => cb(null, assetsDir))
      .catch((error) => cb(error as Error, ''));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (isAllowedImageMimeType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

const attachmentUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

/**
 * Stores chat image attachments in the global `~/.cloudcli/assets` folder and
 * returns their absolute paths for use in provider prompts and chat history.
 */
router.post('/images', (req, res) => {
  upload.array('images', 5)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No image files provided' });
    }

    res.json({ images: buildStoredImageRecords(files) });
  });
});

/**
 * Stores provider-neutral chat attachments. Files of any MIME type are
 * accepted because providers inspect them as data through their file-reading
 * tools; uploads are capped at 10 files and 10MB per file.
 */
router.post('/files', (req, res, next) => {
  attachmentUpload.array('files', 10)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      return res.status(400).json({ error: message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : null;
    try {
      recordLegacyAttachments(files, projectPath);
      res.json({ attachments: buildStoredAttachmentRecords(files) });
    } catch (error) {
      next(error);
    }
  });
});

/**
 * Attachments of up to 256 MB arrive in 8 MB pieces, because the Cloudflare
 * Tunnel in front of ClaudeWeb refuses requests over 100 MB. Small files use
 * the same path as a single piece.
 */
router.post('/uploads', respond((req) => chunkedUploadService.create(req.body)));
router.put(
  '/uploads/:uploadId/chunks/:index',
  // Pieces are raw bytes; the global JSON parser leaves this content type alone.
  express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_CHUNK_BYTES }),
  respond((req) => chunkedUploadService.writeChunk(param(req, 'uploadId'), Number(param(req, 'index')), req.body)),
);
router.post('/uploads/:uploadId/complete', respond(async (req) => ({
  attachment: await chunkedUploadService.complete(param(req, 'uploadId')),
})));
router.delete('/uploads/:uploadId', respond(async (req) => {
  await chunkedUploadService.cancel(param(req, 'uploadId'));
  return { cancelled: true };
}));

/** The project's File management page: list, download again, delete. */
router.get('/project-files', respond((req) => ({ files: projectFilesService.list(req.query.projectPath) })));
router.get('/project-files/:storedName/download', async (req, res, next) => {
  try {
    const file = await projectFilesService.open(param(req, 'storedName'));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', contentDispositionFor(file.name));
    file.stream.on('error', (error) => {
      console.error('Error streaming project file:', error);
      res.destroy(error);
    });
    file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
});
router.delete('/project-files/:storedName', respond((req) => projectFilesService.remove(param(req, 'storedName'))));

/**
 * Serves one stored image asset by filename. Only files directly inside the
 * global assets folder are reachable; traversal attempts resolve to null.
 */
router.get('/images/:filename', async (req, res) => {
  const asset = await openStoredAttachmentAsset(req.params.filename);
  if (asset.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }
  if (asset.status === 'missing') {
    return res.status(404).json({ error: 'Asset not found' });
  }

  res.setHeader('Content-Type', asset.contentType);
  // Stored-XSS hardening: never let the browser sniff a different type, and
  // force SVGs (which can carry scripts when rendered as a document) to
  // download instead of rendering inline. The chat UI is unaffected — it
  // fetches assets as blobs and shows them through <img>, where SVG scripts
  // never execute.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (asset.contentType === 'image/svg+xml') {
    res.setHeader('Content-Disposition', 'attachment');
  }
  asset.stream.pipe(res);
  asset.stream.on('error', (error) => {
    console.error('Error streaming image asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

/**
 * Downloads one stored non-image attachment. Content-Disposition prevents
 * uploaded HTML or other active formats from rendering in the application.
 */
router.get('/files/:filename', async (req, res) => {
  const asset = await openStoredAttachmentAsset(req.params.filename);
  if (asset.status === 'invalid') {
    return res.status(400).json({ error: 'Invalid asset filename' });
  }
  if (asset.status === 'missing') {
    return res.status(404).json({ error: 'Asset not found' });
  }

  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename.replace(/["\r\n]/g, '_')}"`);
  asset.stream.pipe(res);
  asset.stream.on('error', (error) => {
    console.error('Error streaming attachment asset:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading asset' });
    }
  });
});

export default router;

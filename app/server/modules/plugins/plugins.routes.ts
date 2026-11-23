import fs from 'node:fs';
import http from 'node:http';

import express from 'express';

import { AppError } from '@/shared/utils.js';

import { SAFE_MEDIA_MIME_TYPES } from './plugin-contract.js';
import type { createPluginsService } from './plugins.service.js';
import type { createPublicAppearanceService } from './public-appearance.service.js';

type AuthenticatedRequest = express.Request & { authSessionId?: string };

const DEFAULT_MAX_UPLOAD_BYTES = (() => {
  const parsed = Number.parseInt(process.env.CLAUDEWEB_PLUGIN_MAX_UPLOAD_BYTES || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100 * 1024 * 1024;
})();

function wildcardPath(req: express.Request): string {
  return ((req.params as Record<string, string>)['0'] ?? '').trim();
}

function routeParameter(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}

function stripMimeParams(contentType: string | string[] | undefined): string {
  const raw = Array.isArray(contentType) ? contentType[0] ?? '' : contentType ?? '';
  return raw.split(';')[0]?.trim().toLowerCase() ?? '';
}

function readRawBuffer(req: express.Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new AppError(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit`, {
        code: 'UPLOAD_TOO_LARGE',
        statusCode: 413,
      }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        fail(new AppError(`Upload exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit`, {
          code: 'UPLOAD_TOO_LARGE',
          statusCode: 413,
        }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', (err) => fail(err));
    req.on('aborted', () => fail(new AppError('Upload aborted', { code: 'UPLOAD_ABORTED', statusCode: 400 })));
  });
}

function parseSingleRange(rangeHeader: string, totalSize: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (!startStr) {
    const suffix = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    end = endStr ? Number.parseInt(endStr, 10) : totalSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalSize || end < start) {
      return 'unsatisfiable';
    }
    end = Math.min(end, totalSize - 1);
  }
  return { start, end };
}

/** Creates authenticated plugin management and RPC routes. */
export function createPluginsRouter(
  service: ReturnType<typeof createPluginsService>,
  options: { maxUploadBytes?: number } = {},
): express.Router {
  const router = express.Router();
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;

  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  router.get('/', respond(() => service.list()));
  router.put('/background/active', respond((req) => service.setActiveBackground(req.body?.name ?? null)));
  router.get('/:name/manifest', respond((req) => service.getManifest(routeParameter(req.params.name))));
  router.get('/:name/assets/*', async (req, res, next) => {
    try {
      const asset = service.resolveAsset(routeParameter(req.params.name), wildcardPath(req));
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const stream = fs.createReadStream(asset.path);
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) { next(error); }
  });
  router.put('/:name/enable', respond((req) => service.setEnabled(
    routeParameter(req.params.name),
    req.body?.enabled,
    { takeoverBackground: req.body?.takeoverBackground === true },
  )));
  router.post('/install', respond((req) => service.install(req.body?.url)));
  router.post('/:name/update', respond((req) => service.update(routeParameter(req.params.name))));
  router.post('/:name/restart', respond((req) => service.restart(routeParameter(req.params.name))));

  // Short-lived, single-path, session-bound media ticket minting (for <video>/<img> playback).
  router.post('/:name/media-ticket', respond((req) => service.createMediaTicket(
    routeParameter(req.params.name),
    req.body?.path,
    (req as AuthenticatedRequest).authSessionId ?? '',
    req.body?.ttlMs,
  )));

  // Authenticated login-screen public appearance publishing (requires manifest.publicAppearance: true).
  router.post('/:name/public-appearance/media', async (req, res, next) => {
    try {
      const name = routeParameter(req.params.name);
      const buffer = await readRawBuffer(req, maxUploadBytes);
      res.json(service.storePublicAppearanceMedia(name, buffer));
    } catch (error) { next(error); }
  });
  router.put('/:name/public-appearance', respond((req) => service.publishPublicAppearance(
    routeParameter(req.params.name),
    req.body,
  )));
  router.delete('/:name/public-appearance', respond((req) => service.clearPublicAppearance(
    routeParameter(req.params.name),
  )));

  router.all('/:name/rpc/*', async (req, res, next) => {
    try {
      const name = routeParameter(req.params.name);
      const isLocalHistory = req.method === 'GET' && name === 'claude-usage' && wildcardPath(req) === 'dashboard';
      const { port, secrets } = await (isLocalHistory ? service.prepareUsageDashboard() : service.prepareRpc(name));

      const rawContentType = String(req.headers['content-type'] ?? '');
      const isJsonBody = rawContentType.toLowerCase().includes('json');
      const headers: Record<string, string> = {
        'content-type': rawContentType || 'application/json',
      };
      for (const passthrough of ['range', 'if-range', 'if-none-match', 'if-modified-since', 'accept'] as const) {
        const val = req.headers[passthrough];
        if (typeof val === 'string' && val) headers[passthrough] = val;
      }
      for (const [key, value] of Object.entries(secrets)) {
        headers[`x-plugin-secret-${key.toLowerCase()}`] = String(value);
      }

      const query = req.url.includes('?') ? `?${req.url.split('?').slice(1).join('?')}` : '';
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const shouldStreamRaw = hasBody && !isJsonBody;

      if (shouldStreamRaw) {
        const declared = Number(req.headers['content-length'] ?? 0);
        if (Number.isFinite(declared) && declared > maxUploadBytes) {
          res.status(413).json({
            success: false,
            error: { code: 'UPLOAD_TOO_LARGE', message: `Upload exceeds ${Math.round(maxUploadBytes / (1024 * 1024))} MiB limit` },
          });
          req.resume();
          return;
        }
        if (typeof req.headers['content-length'] === 'string') {
          headers['content-length'] = req.headers['content-length'];
        }
      }

      const proxyRequest = http.request({
        hostname: '127.0.0.1',
        port,
        path: `/${wildcardPath(req)}${query}`,
        method: req.method,
        headers,
      }, (proxyResponse) => {
        res.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(res);
      });

      proxyRequest.on('error', (err) => {
        if (!res.headersSent) next(err);
        else res.destroy();
      });

      if (shouldStreamRaw) {
        let streamedBytes = 0;
        let overflowed = false;
        req.on('data', (chunk: Buffer) => {
          streamedBytes += chunk.length;
          if (streamedBytes > maxUploadBytes) {
            overflowed = true;
            proxyRequest.destroy();
            req.destroy();
            if (!res.headersSent) {
              res.status(413).json({
                success: false,
                error: { code: 'UPLOAD_TOO_LARGE', message: `Upload exceeds ${Math.round(maxUploadBytes / (1024 * 1024))} MiB limit` },
              });
            }
            return;
          }
          if (!proxyRequest.write(chunk)) {
            req.pause();
            proxyRequest.once('drain', () => req.resume());
          }
        });
        req.on('end', () => {
          if (!overflowed) proxyRequest.end();
        });
        req.on('aborted', () => proxyRequest.destroy());
        res.on('close', () => {
          if (!res.writableFinished) proxyRequest.destroy();
        });
      } else {
        if (req.headers['content-length'] && req.body !== undefined) {
          const body = JSON.stringify(req.body);
          proxyRequest.setHeader('content-length', Buffer.byteLength(body));
          proxyRequest.write(body);
        }
        proxyRequest.end();
      }
    } catch (error) { next(error); }
  });

  router.delete('/:name', respond((req) => service.uninstall(
    routeParameter(req.params.name),
    { removeData: req.query.removeData === '1' || req.body?.removeData === true },
  )));

  return router;
}

/**
 * Ticket-authenticated media proxy mounted at `/api/plugins` BEFORE `authenticateToken`,
 * matching ONLY `GET/HEAD /:name/media/:ticketId` so native `<video>`/`<img>` playback works
 * with full Range/Seek support and zero JWT exposure in URLs.
 */
export function createPluginMediaRouter(service: ReturnType<typeof createPluginsService>): express.Router {
  const router = express.Router();

  const handleMedia = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const name = routeParameter(req.params.name);
      const ticketId = routeParameter(req.params.ticketId);
      const { port, secrets, normalizedPath } = await service.prepareMediaRequest(name, ticketId);

      const headers: Record<string, string> = {};
      for (const passthrough of ['range', 'if-range', 'if-none-match', 'if-modified-since'] as const) {
        const val = req.headers[passthrough];
        if (typeof val === 'string' && val) headers[passthrough] = val;
      }
      for (const [key, value] of Object.entries(secrets)) {
        headers[`x-plugin-secret-${key.toLowerCase()}`] = String(value);
      }

      const proxyRequest = http.request({
        hostname: '127.0.0.1',
        port,
        path: normalizedPath,
        method: req.method,
        headers,
      }, (proxyResponse) => {
        const status = proxyResponse.statusCode ?? 502;
        const mimeType = stripMimeParams(proxyResponse.headers['content-type']);
        if ((status === 200 || status === 206) && !SAFE_MEDIA_MIME_TYPES.has(mimeType)) {
          proxyResponse.resume();
          res.status(415).json({
            success: false,
            error: { code: 'UNSAFE_MEDIA_TYPE', message: 'Plugin media endpoint returned a disallowed content type' },
          });
          return;
        }

        const safeHeaders: Record<string, string | string[]> = {
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
        };
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'] as const) {
          const val = proxyResponse.headers[key];
          if (val !== undefined) safeHeaders[key] = val;
        }
        res.writeHead(status, safeHeaders);
        if (req.method === 'HEAD') {
          proxyResponse.resume();
          res.end();
          return;
        }
        proxyResponse.pipe(res);
      });

      proxyRequest.on('error', (err) => {
        if (!res.headersSent) next(err);
        else res.destroy();
      });
      res.on('close', () => {
        if (!res.writableFinished) proxyRequest.destroy();
      });
      proxyRequest.end();
    } catch (error) { next(error); }
  };

  router.get('/:name/media/:ticketId', handleMedia);
  router.head('/:name/media/:ticketId', handleMedia);
  return router;
}

/**
 * Unauthenticated, strictly scoped public login-screen appearance router.
 * Control state is always `no-store`; media supports Range/ETag and only serves whitelisted active hashes.
 */
export function createPublicAppearanceRouter(
  appearanceService: ReturnType<typeof createPublicAppearanceService>,
): express.Router {
  const router = express.Router();

  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.json(appearanceService.getPublicState());
  });

  const handlePublicMedia = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const hash = routeParameter(req.params.hash);
    const resolved = appearanceService.resolvePublicMedia(hash);
    if (!resolved) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).end();
      return;
    }

    res.setHeader('ETag', resolved.etag);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', resolved.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");

    if (req.headers['if-none-match'] === resolved.etag) {
      res.status(304).end();
      return;
    }

    const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : '';
    if (rangeHeader) {
      const parsed = parseSingleRange(rangeHeader, resolved.size);
      if (parsed === 'unsatisfiable') {
        res.setHeader('Content-Range', `bytes */${resolved.size}`);
        res.status(416).end();
        return;
      }
      if (parsed) {
        const chunkLength = parsed.end - parsed.start + 1;
        res.status(206);
        res.setHeader('Content-Range', `bytes ${parsed.start}-${parsed.end}/${resolved.size}`);
        res.setHeader('Content-Length', String(chunkLength));
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        const stream = fs.createReadStream(resolved.filePath, { start: parsed.start, end: parsed.end });
        stream.on('error', next);
        stream.pipe(res);
        return;
      }
    }

    res.setHeader('Content-Length', String(resolved.size));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(resolved.filePath);
    stream.on('error', next);
    stream.pipe(res);
  };

  router.get('/media/:hash', handlePublicMedia);
  router.head('/media/:hash', handlePublicMedia);
  return router;
}

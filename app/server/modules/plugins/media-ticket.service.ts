import { randomBytes } from 'node:crypto';

import { AppError } from '@/shared/utils.js';

export type MediaTicketRecord = {
  ticketId: string;
  pluginName: string;
  normalizedPath: string;
  sessionId: string;
  expiresAt: number;
};

type MediaTicketServiceOptions = {
  now?: () => number;
  sessionAlive?: (sessionId: string) => boolean;
  defaultTtlMs?: number;
  maxTtlMs?: number;
  minTtlMs?: number;
  maxTickets?: number;
};

const DEFAULT_TTL_MS = 10 * 60_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 15 * 60_000;
const MAX_TICKETS = 2048;

/**
 * Normalizes a plugin-local media path for ticket binding.
 * Allows clean POSIX paths (with optional simple query params) and blocks traversal/control chars.
 */
export function normalizePluginMediaPath(rawPath: unknown): string {
  if (typeof rawPath !== 'string') {
    throw new AppError('Media path must be a string', { code: 'INVALID_MEDIA_PATH', statusCode: 400 });
  }
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.length > 512) {
    throw new AppError('Media path is empty or too long', { code: 'INVALID_MEDIA_PATH', statusCode: 400 });
  }
  if (/[\x00-\x1f\x7f\\]/.test(trimmed) || trimmed.includes('..') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    throw new AppError('Media path is not allowed', { code: 'INVALID_MEDIA_PATH', statusCode: 400 });
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withLeadingSlash.startsWith('//')) {
    throw new AppError('Media path must be relative to the plugin server', { code: 'INVALID_MEDIA_PATH', statusCode: 400 });
  }
  return withLeadingSlash;
}

/**
 * Manages short-lived, single-path, session-bound opaque tickets so native <video> and <img>
 * elements can stream plugin media with Range/Seek support without exposing session JWTs in URLs.
 */
export function createMediaTicketService(options: MediaTicketServiceOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const sessionAlive = options.sessionAlive ?? (() => true);
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
  const minTtlMs = options.minTtlMs ?? MIN_TTL_MS;
  const maxTtlMs = options.maxTtlMs ?? MAX_TTL_MS;
  const maxTickets = options.maxTickets ?? MAX_TICKETS;

  const tickets = new Map<string, MediaTicketRecord>();

  function sweepExpired(timestamp: number): void {
    for (const [id, record] of tickets) {
      if (record.expiresAt <= timestamp || !sessionAlive(record.sessionId)) {
        tickets.delete(id);
      }
    }
  }

  return {
    createTicket(input: { pluginName: string; path: unknown; sessionId: string; ttlMs?: unknown }) {
      if (!input.sessionId) {
        throw new AppError('Authentication session required', { code: 'AUTH_TOKEN_INVALID', statusCode: 401 });
      }
      const normalizedPath = normalizePluginMediaPath(input.path);
      const requestedTtl = typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs)
        ? Math.floor(input.ttlMs)
        : defaultTtlMs;
      const ttlMs = Math.min(maxTtlMs, Math.max(minTtlMs, requestedTtl));
      const timestamp = now();
      sweepExpired(timestamp);

      while (tickets.size >= maxTickets) {
        const oldestKey = tickets.keys().next().value;
        if (!oldestKey) break;
        tickets.delete(oldestKey);
      }

      const ticketId = randomBytes(32).toString('base64url');
      const expiresAt = timestamp + ttlMs;
      const record: MediaTicketRecord = {
        ticketId,
        pluginName: input.pluginName,
        normalizedPath,
        sessionId: input.sessionId,
        expiresAt,
      };
      tickets.set(ticketId, record);

      return {
        ticketId,
        url: `/api/plugins/${encodeURIComponent(input.pluginName)}/media/${ticketId}`,
        expiresAt,
      };
    },

    resolveTicket(pluginName: string, ticketId: string): MediaTicketRecord | null {
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(ticketId)) return null;
      const record = tickets.get(ticketId);
      if (!record) return null;
      if (record.pluginName !== pluginName) return null;
      if (record.expiresAt <= now() || !sessionAlive(record.sessionId)) {
        tickets.delete(ticketId);
        return null;
      }
      return record;
    },

    revokeForPlugin(pluginName: string): number {
      let removed = 0;
      for (const [id, record] of tickets) {
        if (record.pluginName === pluginName) {
          tickets.delete(id);
          removed += 1;
        }
      }
      return removed;
    },

    revokeForSession(sessionId: string): number {
      let removed = 0;
      for (const [id, record] of tickets) {
        if (record.sessionId === sessionId) {
          tickets.delete(id);
          removed += 1;
        }
      }
      return removed;
    },

    clearAll(): void {
      tickets.clear();
    },

    size(): number {
      return tickets.size;
    },
  };
}

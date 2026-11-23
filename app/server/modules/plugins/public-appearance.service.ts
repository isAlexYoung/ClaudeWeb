import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AppError } from '@/shared/utils.js';

import {
  detectSafeMediaMime,
  isSafeCssGradient,
  SAFE_MEDIA_MIME_TO_EXT,
  SAFE_MEDIA_MIME_TYPES,
  type PublicAppearanceFit,
  type PublicAppearanceScrimMode,
  type PublicAppearanceSlot,
  type PublicAppearanceState,
  type PublicAppearanceThemeKey,
  type StoredPublicAppearanceState,
} from './plugin-contract.js';

const THEME_KEYS: PublicAppearanceThemeKey[] = ['default', 'warm', 'light', 'dark'];
const FITS = new Set<PublicAppearanceFit>(['cover', 'contain', 'center']);
const SCRIM_MODES = new Set<PublicAppearanceScrimMode>(['auto', 'light', 'dark']);
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_ACTIVE_MEDIA_FILES = 6; // up to 3 theme slots * (media + poster)

type PublicAppearanceOptions = {
  rootDir?: string;
  maxMediaBytes?: number;
  isPluginAllowed?: (pluginName: string) => boolean;
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function emptyState(): PublicAppearanceState {
  return {
    schema: 1,
    enabled: false,
    revision: '0',
    mode: 'single',
    slots: {},
  };
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* already moved or absent */ }
  }
}

/**
 * Manages the strictly scoped, non-sensitive login-screen appearance snapshot.
 * Unauthenticated clients only read validated visual properties and whitelisted media files;
 * no plugin metadata, paths or third-party JS are exposed before sign-in.
 */
export function createPublicAppearanceService(options: PublicAppearanceOptions = {}) {
  const rootDir = options.rootDir
    ?? path.join(os.homedir(), '.claude-code-ui', 'public-appearance');
  const mediaDir = path.join(rootDir, 'media');
  const statePath = path.join(rootDir, 'state.json');
  const maxMediaBytes = options.maxMediaBytes ?? DEFAULT_MAX_MEDIA_BYTES;
  const isPluginAllowed = options.isPluginAllowed ?? (() => true);

  function ensureDirs(): void {
    fs.mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
  }

  function findMediaFileByHash(hash: string): { filePath: string; mimeType: string; size: number } | null {
    if (!HASH_PATTERN.test(hash) || !fs.existsSync(mediaDir)) return null;
    for (const [mimeType, ext] of Object.entries(SAFE_MEDIA_MIME_TO_EXT)) {
      const candidate = path.join(mediaDir, `${hash}${ext}`);
      try {
        const stat = fs.lstatSync(candidate);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1) {
          return { filePath: candidate, mimeType, size: stat.size };
        }
      } catch { /* try next extension */ }
    }
    return null;
  }

  function readStoredState(): StoredPublicAppearanceState | null {
    try {
      const stat = fs.lstatSync(statePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) return null;
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<StoredPublicAppearanceState>;
      if (!parsed || typeof parsed !== 'object' || parsed.schema !== 1) return null;
      return {
        schema: 1,
        enabled: parsed.enabled === true,
        revision: typeof parsed.revision === 'string' && parsed.revision ? parsed.revision : '0',
        mode: parsed.mode === 'per-theme' ? 'per-theme' : 'single',
        slots: parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : {},
        ownerPlugin: typeof parsed.ownerPlugin === 'string' ? parsed.ownerPlugin : null,
      };
    } catch {
      return null;
    }
  }

  function collectReferencedHashes(state: PublicAppearanceState): Set<string> {
    const hashes = new Set<string>();
    for (const key of THEME_KEYS) {
      const slot = state.slots[key];
      if (!slot) continue;
      if (slot.mediaHash && HASH_PATTERN.test(slot.mediaHash)) hashes.add(slot.mediaHash);
      if (slot.posterHash && HASH_PATTERN.test(slot.posterHash)) hashes.add(slot.posterHash);
    }
    return hashes;
  }

  function gcUnusedMedia(referenced: Set<string>): void {
    if (!fs.existsSync(mediaDir)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(mediaDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const hash = entry.name.split('.')[0] ?? '';
      if (!referenced.has(hash)) {
        try { fs.unlinkSync(path.join(mediaDir, entry.name)); } catch { /* ignore */ }
      }
    }
  }

  function validateSlot(raw: unknown): PublicAppearanceSlot {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new AppError('Invalid public appearance slot', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
    }
    const obj = raw as Record<string, unknown>;
    const mediaType = obj.mediaType;
    if (mediaType !== 'none' && mediaType !== 'gradient' && mediaType !== 'image' && mediaType !== 'video') {
      throw new AppError('Invalid public appearance mediaType', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
    }

    const fit: PublicAppearanceFit = FITS.has(obj.fit as PublicAppearanceFit) ? (obj.fit as PublicAppearanceFit) : 'cover';
    const scrimMode: PublicAppearanceScrimMode = SCRIM_MODES.has(obj.scrimMode as PublicAppearanceScrimMode)
      ? (obj.scrimMode as PublicAppearanceScrimMode)
      : 'auto';

    const slot: PublicAppearanceSlot = {
      mediaType,
      fit,
      positionX: clampNumber(obj.positionX, 50, 0, 100),
      positionY: clampNumber(obj.positionY, 50, 0, 100),
      blurPx: clampNumber(obj.blurPx, 0, 0, 48),
      scrimOpacity: clampNumber(obj.scrimOpacity, 0.35, 0, 0.95),
      scrimMode,
      cardOpacity: clampNumber(obj.cardOpacity, 0.9, 0.45, 1),
    };

    if (mediaType === 'gradient') {
      if (!isSafeCssGradient(obj.cssGradient)) {
        throw new AppError('Invalid CSS gradient for public appearance', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
      }
      slot.cssGradient = obj.cssGradient.trim();
    } else if (mediaType === 'image' || mediaType === 'video') {
      const mediaHash = typeof obj.mediaHash === 'string' ? obj.mediaHash : '';
      const found = findMediaFileByHash(mediaHash);
      if (!found) {
        throw new AppError('Referenced public appearance media has not been uploaded', { code: 'PUBLIC_MEDIA_NOT_FOUND', statusCode: 400 });
      }
      if (mediaType === 'image' && !found.mimeType.startsWith('image/')) {
        throw new AppError('Media type mismatch: expected image', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
      }
      if (mediaType === 'video' && !found.mimeType.startsWith('video/')) {
        throw new AppError('Media type mismatch: expected video', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
      }
      slot.mediaHash = mediaHash;
      slot.mediaMime = found.mimeType;

      if (mediaType === 'video') {
        slot.videoPlaybackRate = clampNumber(obj.videoPlaybackRate, 1, 0.25, 2);
        if (typeof obj.posterHash === 'string' && obj.posterHash) {
          const poster = findMediaFileByHash(obj.posterHash);
          if (!poster || !poster.mimeType.startsWith('image/')) {
            throw new AppError('Invalid video poster image reference', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
          }
          slot.posterHash = obj.posterHash;
          slot.posterMime = poster.mimeType;
        }
      }
    }

    return slot;
  }

  return {
    getPublicState(): PublicAppearanceState {
      const stored = readStoredState();
      if (!stored || !stored.enabled || !stored.ownerPlugin || !isPluginAllowed(stored.ownerPlugin)) {
        return emptyState();
      }
      return {
        schema: 1,
        enabled: true,
        revision: stored.revision,
        mode: stored.mode,
        slots: stored.slots,
      };
    },

    resolvePublicMedia(hash: string): { filePath: string; mimeType: string; size: number; etag: string } | null {
      if (!HASH_PATTERN.test(hash)) return null;
      const state = this.getPublicState();
      if (!state.enabled) return null;
      const referenced = collectReferencedHashes(state);
      if (!referenced.has(hash)) return null;
      const found = findMediaFileByHash(hash);
      if (!found || !SAFE_MEDIA_MIME_TYPES.has(found.mimeType)) return null;
      return { ...found, etag: `"${hash}"` };
    },

    storeMediaBuffer(buffer: Buffer): { hash: string; mimeType: string; bytes: number } {
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new AppError('Empty media upload', { code: 'INVALID_PUBLIC_MEDIA', statusCode: 400 });
      }
      if (buffer.length > maxMediaBytes) {
        throw new AppError(`Public media exceeds ${Math.round(maxMediaBytes / (1024 * 1024))} MiB limit`, {
          code: 'PUBLIC_MEDIA_TOO_LARGE',
          statusCode: 413,
        });
      }
      const mimeType = detectSafeMediaMime(buffer);
      if (!mimeType) {
        throw new AppError('Unsupported or unsafe media format (PNG/JPEG/WebP/AVIF/GIF/MP4/WebM only)', {
          code: 'UNSUPPORTED_PUBLIC_MEDIA',
          statusCode: 415,
        });
      }
      ensureDirs();
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const ext = SAFE_MEDIA_MIME_TO_EXT[mimeType];
      const targetPath = path.join(mediaDir, `${hash}${ext}`);
      if (!fs.existsSync(targetPath)) {
        const tempPath = `${targetPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
        try {
          fs.writeFileSync(tempPath, buffer, { mode: 0o600 });
          fs.renameSync(tempPath, targetPath);
        } finally {
          try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        }
      }
      return { hash, mimeType, bytes: buffer.length };
    },

    publish(pluginName: string, payload: unknown): PublicAppearanceState {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AppError('Invalid public appearance payload', { code: 'INVALID_PUBLIC_APPEARANCE', statusCode: 400 });
      }
      const body = payload as Record<string, unknown>;
      const enabled = body.enabled === true;
      const mode: 'single' | 'per-theme' = body.mode === 'per-theme' ? 'per-theme' : 'single';

      if (!enabled) {
        this.clear(pluginName);
        return emptyState();
      }

      const rawSlots = body.slots && typeof body.slots === 'object' && !Array.isArray(body.slots)
        ? (body.slots as Record<string, unknown>)
        : {};
      const slots: Partial<Record<PublicAppearanceThemeKey, PublicAppearanceSlot>> = {};
      for (const key of THEME_KEYS) {
        if (rawSlots[key] !== undefined && rawSlots[key] !== null) {
          slots[key] = validateSlot(rawSlots[key]);
        }
      }
      if (Object.keys(slots).length === 0) {
        throw new AppError('At least one public appearance slot is required when enabled', {
          code: 'INVALID_PUBLIC_APPEARANCE',
          statusCode: 400,
        });
      }

      const revision = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const next: StoredPublicAppearanceState = {
        schema: 1,
        enabled: true,
        revision,
        mode,
        slots,
        ownerPlugin: pluginName,
      };
      const referenced = collectReferencedHashes(next);
      if (referenced.size > MAX_ACTIVE_MEDIA_FILES) {
        throw new AppError('Too many public appearance media files referenced', {
          code: 'INVALID_PUBLIC_APPEARANCE',
          statusCode: 400,
        });
      }

      ensureDirs();
      atomicWriteJson(statePath, next);
      gcUnusedMedia(referenced);

      return {
        schema: 1,
        enabled: true,
        revision,
        mode,
        slots,
      };
    },

    clear(pluginName?: string): boolean {
      const existing = readStoredState();
      if (pluginName && existing && existing.ownerPlugin && existing.ownerPlugin !== pluginName) {
        return false;
      }
      const cleared: StoredPublicAppearanceState = {
        ...emptyState(),
        revision: `${Date.now()}-cleared`,
        ownerPlugin: null,
      };
      ensureDirs();
      atomicWriteJson(statePath, cleared);
      gcUnusedMedia(new Set());
      return true;
    },

    maxMediaBytes,
  };
}

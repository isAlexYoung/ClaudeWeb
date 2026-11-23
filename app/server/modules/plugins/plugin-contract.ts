export const PLUGIN_API_VERSION = 2;

export const ALLOWED_PLUGIN_SLOTS = ['tab', 'background', 'overlay', 'settings'] as const;
export type PluginSlot = (typeof ALLOWED_PLUGIN_SLOTS)[number];

export const HOST_CAPABILITIES = [
  'slots:tab',
  'slots:background',
  'slots:overlay',
  'slots:settings',
  'media-ticket',
  'rpc-raw-stream',
  'agent-events-v1',
  'public-appearance-v1',
  'style-manager',
  'surface-wallpaper-vars',
] as const;

export type HostCapability = (typeof HOST_CAPABILITIES)[number];
export const HOST_CAPABILITY_SET = new Set<string>(HOST_CAPABILITIES);

export type PluginPanelMode = 'drawer' | 'modal';

export type PluginPanelConfig = {
  title?: string;
  mode: PluginPanelMode;
  width: number;
};

export type PluginBuildConfig = {
  mode: 'auto' | 'prebuilt';
  integrity?: Record<string, string>;
};

export const SAFE_MEDIA_MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

export const SAFE_MEDIA_MIME_TYPES = new Set<string>(Object.keys(SAFE_MEDIA_MIME_TO_EXT));

/**
 * Sniffs safe static/animated image or video MIME types from file magic bytes.
 * Rejects SVG, HTML, scripts and unknown formats.
 */
export function detectSafeMediaMime(buffer: Buffer): string | null {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a
  const gifHeader = buffer.subarray(0, 6).toString('ascii');
  if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // WebM / EBML: 1A 45 DF A3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return 'video/webm';
  }

  // ISO BMFF (AVIF / MP4): ....ftyp<brand>
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const majorBrand = buffer.subarray(8, 12).toString('ascii');
    const compatibleBrands = buffer.subarray(8, Math.min(buffer.length, 64)).toString('ascii');
    if (majorBrand === 'avif' || majorBrand === 'avis' || compatibleBrands.includes('avif') || compatibleBrands.includes('avis')) {
      return 'image/avif';
    }
    if (
      ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ', 'dash', 'msnv'].includes(majorBrand)
      || compatibleBrands.includes('mp41')
      || compatibleBrands.includes('mp42')
      || compatibleBrands.includes('isom')
      || compatibleBrands.includes('avc1')
    ) {
      return 'video/mp4';
    }
  }

  return null;
}

/**
 * Validates that a CSS gradient string contains only safe gradient syntax
 * without url(), CSS injection characters, or script constructs.
 */
export function isSafeCssGradient(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (!/^(?:linear-gradient|radial-gradient|conic-gradient)\([^;{}<>\\]+\)$/i.test(trimmed)) return false;
  if (/(?:url|expression|javascript|@import)/i.test(trimmed)) return false;
  return true;
}

export type PublicAppearanceSlotMediaType = 'none' | 'gradient' | 'image' | 'video';
export type PublicAppearanceFit = 'cover' | 'contain' | 'center';
export type PublicAppearanceScrimMode = 'auto' | 'light' | 'dark';
export type PublicAppearanceThemeKey = 'default' | 'warm' | 'light' | 'dark';

export type PublicAppearanceSlot = {
  mediaType: PublicAppearanceSlotMediaType;
  cssGradient?: string;
  mediaHash?: string;
  mediaMime?: string;
  posterHash?: string;
  posterMime?: string;
  fit: PublicAppearanceFit;
  positionX: number;
  positionY: number;
  blurPx: number;
  scrimOpacity: number;
  scrimMode: PublicAppearanceScrimMode;
  cardOpacity: number;
  videoPlaybackRate?: number;
};

export type PublicAppearanceState = {
  schema: 1;
  enabled: boolean;
  revision: string;
  mode: 'single' | 'per-theme';
  slots: Partial<Record<PublicAppearanceThemeKey, PublicAppearanceSlot>>;
};

export type StoredPublicAppearanceState = PublicAppearanceState & {
  ownerPlugin: string | null;
};

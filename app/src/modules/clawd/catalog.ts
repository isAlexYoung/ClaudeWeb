import catalog from '@/modules/clawd/data/clawd-catalog.json';

/**
 * One of the 400 Clawd animations (Clawd 400 by 风花叶 — CC BY 4.0,
 * https://github.com/khiqwq/clawd-400), redrawn by app/scripts/build-clawd-assets.py
 * as a strip of 40x40 frames in public/clawd/NNN.png.
 */
export type ClawdAnimation = {
  n: number;
  slug: string;
  zh: string;
  en: string;
  theme: string;
  /** Duration of each frame in milliseconds; the strip holds one frame per entry. */
  d: number[];
};

export const CLAWD_FRAME_SIZE = 40;

const animations = new Map<number, ClawdAnimation>((catalog as ClawdAnimation[]).map((item) => [item.n, item]));

/** Used by ClawdSprite to time a strip's frames; undefined for a number that is not in the catalog. */
export function clawdAnimation(n: number): ClawdAnimation | undefined {
  return animations.get(n);
}

/** Where the page loads an animation's frame strip from. */
export function clawdSheetUrl(n: number): string {
  return `${import.meta.env.BASE_URL}clawd/${String(n).padStart(3, '0')}.png`;
}

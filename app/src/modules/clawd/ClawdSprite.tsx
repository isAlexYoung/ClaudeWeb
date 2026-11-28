import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

import { CLAWD_FRAME_SIZE, clawdAnimation, clawdSheetUrl } from '@/modules/clawd/catalog';
import '@/modules/clawd/clawd.css';

// One decoded strip per animation, shared by every sprite on the page.
const sheets = new Map<number, Promise<HTMLImageElement>>();

function loadSheet(n: number): Promise<HTMLImageElement> {
  let pending = sheets.get(n);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => { sheets.delete(n); reject(new Error(`Clawd ${n} did not load`)); };
      image.src = clawdSheetUrl(n);
    });
    sheets.set(n, pending);
  }
  return pending;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The system's "reduce motion" setting, followed live. */
function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCED_MOTION);
    const update = () => setReduced(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

// Two taps closer than this count as a double tap on touch screens, where dblclick is unreliable.
const DOUBLE_TAP_MS = 320;

type ClawdSpriteProps = {
  /** Number of the animation in the catalog (1-400). */
  animation: number;
  /** Displayed width and height in CSS pixels; the 40x40 frames are scaled without smoothing. */
  size: number;
  /** Shows the first frame only (the user's "still Clawd" setting); the system's reduce-motion setting does the same. */
  still?: boolean;
  /** Double click or double tap; omitted when switching is turned off. */
  onDoubleActivate?: () => void;
  className?: string;
};

/**
 * Used by ClawdGreeting and the chat composer's Clawd: draws one animation's frame strip on a
 * canvas with each frame's own duration. It pauses while the page is hidden or the sprite is off
 * screen, cannot be selected, dragged or saved, and is hidden from screen readers.
 */
export default function ClawdSprite({ animation, size, still = false, onDoubleActivate, className }: ClawdSpriteProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastActivation = useRef(0);
  const lastTap = useRef(0);
  const systemReduced = useSystemReducedMotion();
  const frozen = still || systemReduced;

  useEffect(() => {
    const canvas = canvasRef.current;
    const info = clawdAnimation(animation);
    const context = canvas?.getContext('2d') ?? null;
    if (!canvas || !info || !context) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    let image: HTMLImageElement | null = null;
    let onScreen = true;

    const draw = () => {
      if (!image) return;
      context.clearRect(0, 0, CLAWD_FRAME_SIZE, CLAWD_FRAME_SIZE);
      context.drawImage(image, frame * CLAWD_FRAME_SIZE, 0, CLAWD_FRAME_SIZE, CLAWD_FRAME_SIZE, 0, 0, CLAWD_FRAME_SIZE, CLAWD_FRAME_SIZE);
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (cancelled || !image || frozen || !onScreen || document.hidden || info.d.length < 2) return;
      timer = setTimeout(() => {
        frame = (frame + 1) % info.d.length;
        draw();
        schedule();
      }, info.d[frame]);
    };

    loadSheet(animation).then((loaded) => {
      if (cancelled) return;
      image = loaded;
      frame = 0;
      draw();
      schedule();
    }).catch(() => undefined);

    document.addEventListener('visibilitychange', schedule);
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => { onScreen = entries.some((entry) => entry.isIntersecting); schedule(); })
      : null;
    observer?.observe(canvas);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
      observer?.disconnect();
    };
  }, [animation, frozen]);

  const activate = () => {
    if (!onDoubleActivate) return;
    const now = Date.now();
    // A double tap can also produce a dblclick; switch once.
    if (now - lastActivation.current < 400) return;
    lastActivation.current = now;
    onDoubleActivate();
  };

  return (
    <canvas
      ref={canvasRef}
      width={CLAWD_FRAME_SIZE}
      height={CLAWD_FRAME_SIZE}
      aria-hidden="true"
      draggable={false}
      data-clawd-animation={animation}
      className={`clawd-sprite ${onDoubleActivate ? 'clawd-sprite-switchable' : ''} ${className ?? ''}`}
      style={{ width: size, height: size }}
      // A second click would otherwise select the text next to Clawd.
      onMouseDown={(event: MouseEvent) => { if (event.detail > 1) event.preventDefault(); }}
      onDoubleClick={(event: MouseEvent) => { event.preventDefault(); activate(); }}
      onPointerUp={(event: PointerEvent) => {
        if (event.pointerType !== 'touch') return;
        const now = Date.now();
        if (now - lastTap.current < DOUBLE_TAP_MS) { lastTap.current = 0; activate(); } else lastTap.current = now;
      }}
      onContextMenu={(event: MouseEvent) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    />
  );
}

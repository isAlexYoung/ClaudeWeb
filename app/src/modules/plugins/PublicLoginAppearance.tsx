import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { PublicAppearanceSlot, PublicAppearanceState } from '@/shared/types';

const LOGIN_MIRROR_KEY = 'appearance-login-wallpaper';
const LOGIN_CACHE_NAME = 'cw-public-appearance-v1';

type ThemeKey = 'warm' | 'light' | 'dark';

function readDocumentTheme(): ThemeKey {
  if (typeof document === 'undefined') return 'warm';
  const raw = document.documentElement.dataset.theme;
  if (raw === 'dark' || raw === 'light' || raw === 'warm') return raw;
  return document.documentElement.classList.contains('dark') ? 'dark' : 'warm';
}

function readCachedMirror(): PublicAppearanceState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOGIN_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicAppearanceState;
    if (parsed && parsed.enabled === true && parsed.slots && typeof parsed.slots === 'object') {
      return parsed;
    }
  } catch { /* ignore storage errors */ }
  return null;
}

function clearLocalAppearanceMirror(): void {
  try {
    localStorage.removeItem(LOGIN_MIRROR_KEY);
  } catch { /* ignore */ }
  if (typeof caches !== 'undefined') {
    void caches.delete(LOGIN_CACHE_NAME).catch(() => {});
  }
}

function pickActiveSlot(state: PublicAppearanceState | null, theme: ThemeKey): PublicAppearanceSlot | null {
  if (!state || !state.enabled || !state.slots) return null;
  const candidate = state.mode === 'per-theme'
    ? (state.slots[theme] ?? state.slots.default ?? state.slots.warm ?? null)
    : (state.slots.default ?? state.slots[theme] ?? null);
  if (!candidate || candidate.mediaType === 'none') return null;
  return candidate;
}

function mapObjectFit(fit: PublicAppearanceSlot['fit']): 'cover' | 'contain' | 'none' {
  if (fit === 'contain') return 'contain';
  if (fit === 'center') return 'none';
  return 'cover';
}

/**
 * Renders the host-verified public login wallpaper behind AuthScreenLayout and
 * AuthLoadingScreen without ever loading third-party plugin code before login.
 * Revalidates `GET /api/public/appearance` (`no-store`) on every visit and
 * immediately clears local mirrors when the server reports `enabled: false`.
 */
export default function PublicLoginAppearance() {
  const [state, setState] = useState<PublicAppearanceState | null>(() => readCachedMirror());
  const [theme, setTheme] = useState<ThemeKey>(() => readDocumentTheme());
  const [reducedMotion, setReducedMotion] = useState<boolean>(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  // Track `<html data-theme>` changes live (warm / light / dark).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const updateTheme = () => setTheme(readDocumentTheme());
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    return () => observer.disconnect();
  }, []);

  // Track OS reduced-motion preference.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Always revalidate authoritative login appearance state from server (no-store).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.publicAppearance.get();
        if (!active) return;
        if (!res.ok) {
          setState(null);
          clearLocalAppearanceMirror();
          return;
        }
        const data = (await res.json()) as PublicAppearanceState;
        if (!active) return;
        if (data && data.enabled === true && data.slots) {
          setState(data);
          try {
            localStorage.setItem(LOGIN_MIRROR_KEY, JSON.stringify(data));
          } catch { /* ignore storage quota */ }
        } else {
          setState(null);
          clearLocalAppearanceMirror();
        }
      } catch {
        // Offline or unreachable — fall back cleanly to default login surface.
        if (active) setState(null);
      }
    })();
    return () => { active = false; };
  }, []);

  const activeSlot = useMemo(() => pickActiveSlot(state, theme), [state, theme]);

  // Expose CSS hook on `<html>` so AuthScreenLayout / AuthLoadingScreen keep glass contrast cleanly.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (!activeSlot) {
      delete root.dataset.cwLoginWallpaper;
      root.style.removeProperty('--cw-login-card-opacity');
      return;
    }
    root.dataset.cwLoginWallpaper = '1';
    if (typeof activeSlot.cardOpacity === 'number' && Number.isFinite(activeSlot.cardOpacity)) {
      root.style.setProperty('--cw-login-card-opacity', String(Math.min(1, Math.max(0.55, activeSlot.cardOpacity))));
    } else {
      root.style.removeProperty('--cw-login-card-opacity');
    }
    return () => {
      delete root.dataset.cwLoginWallpaper;
      root.style.removeProperty('--cw-login-card-opacity');
    };
  }, [activeSlot]);

  // Apply playbackRate and pause background login video when tab is hidden.
  useEffect(() => {
    if (activeSlot?.mediaType !== 'video' || reducedMotion) return;
    const el = videoRef.current;
    if (el && typeof activeSlot.videoPlaybackRate === 'number' && Number.isFinite(activeSlot.videoPlaybackRate)) {
      el.playbackRate = Math.min(2, Math.max(0.25, activeSlot.videoPlaybackRate));
    }
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) {
        video.pause();
      } else {
        void video.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [activeSlot?.mediaType, activeSlot?.videoPlaybackRate, reducedMotion]);

  if (!activeSlot) return null;

  const blurPx = typeof activeSlot.blurPx === 'number' ? Math.max(0, Math.min(40, activeSlot.blurPx)) : 0;
  const mediaFilter = blurPx > 0 ? `blur(${blurPx}px)` : undefined;
  const scaleTransform = blurPx > 0 ? 'scale(1.06)' : undefined;
  const objectPosition = `${Math.min(100, Math.max(0, activeSlot.positionX ?? 50))}% ${Math.min(100, Math.max(0, activeSlot.positionY ?? 50))}%`;
  const objectFit = mapObjectFit(activeSlot.fit);

  const scrimOpacity = typeof activeSlot.scrimOpacity === 'number'
    ? Math.max(0, Math.min(0.85, activeSlot.scrimOpacity))
    : theme === 'dark'
      ? 0.28
      : 0.14;

  const scrimIsDark = activeSlot.scrimMode === 'dark'
    ? true
    : activeSlot.scrimMode === 'light'
      ? false
      : theme === 'dark';

  const scrimColor = scrimIsDark
    ? `rgba(10, 12, 14, ${scrimOpacity})`
    : `rgba(255, 255, 255, ${scrimOpacity})`;

  return (
    <div
      data-testid="public-login-appearance"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {activeSlot.mediaType === 'gradient' && activeSlot.cssGradient && (
        <div
          className="absolute inset-0"
          style={{
            background: activeSlot.cssGradient,
            filter: mediaFilter,
          }}
        />
      )}

      {activeSlot.mediaType === 'image' && activeSlot.mediaHash && (
        <img
          src={api.publicAppearance.mediaUrl(activeSlot.mediaHash)}
          alt=""
          decoding="async"
          className="h-full w-full"
          style={{
            objectFit,
            objectPosition,
            filter: mediaFilter,
            transform: scaleTransform,
          }}
        />
      )}

      {activeSlot.mediaType === 'video' && activeSlot.mediaHash && (
        reducedMotion ? (
          activeSlot.posterHash ? (
            <img
              src={api.publicAppearance.mediaUrl(activeSlot.posterHash)}
              alt=""
              decoding="async"
              className="h-full w-full"
              style={{
                objectFit,
                objectPosition,
                filter: mediaFilter,
                transform: scaleTransform,
              }}
            />
          ) : (
            <div className="absolute inset-0 bg-background" />
          )
        ) : (
          <video
            ref={videoRef}
            src={api.publicAppearance.mediaUrl(activeSlot.mediaHash)}
            poster={activeSlot.posterHash ? api.publicAppearance.mediaUrl(activeSlot.posterHash) : undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full"
            style={{
              objectFit,
              objectPosition,
              filter: mediaFilter,
              transform: scaleTransform,
            }}
          />
        )
      )}

      <div
        className="absolute inset-0 transition-colors duration-300"
        style={{ backgroundColor: scrimColor }}
      />
    </div>
  );
}

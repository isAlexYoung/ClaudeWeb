import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';

const MIN_WIDTH = 240;
// The browser view has its own, wider width, so it does not change the other tools' width.
const SIZES = {
  normal: { defaultWidth: 292, maxWidth: 560, storageKey: 'workspace-inspector-width' },
  wide: { defaultWidth: 720, maxWidth: 1400, storageKey: 'workspace-inspector-width-browser' },
};

const storedWidth = ({ defaultWidth, maxWidth, storageKey }: typeof SIZES.normal) => {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return stored > 0 && Number.isFinite(stored) ? Math.max(MIN_WIDTH, Math.min(maxWidth, stored)) : defaultWidth;
  } catch { return defaultWidth; }
};

/** Used by WorkspaceMain to resize the Context, terminal, files and browser dock without replacing the chat. */
export default function WorkspaceInspectorDock({ mobile, open = true, wide = false, children }: { mobile: boolean; open?: boolean; wide?: boolean; children: ReactNode }) {
  const { t } = useTranslation('common');
  const { isPresent, presenceProps } = useSurfacePresence(open, 240);
  const size = wide ? SIZES.wide : SIZES.normal;
  const { defaultWidth: DEFAULT_WIDTH, maxWidth: MAX_WIDTH, storageKey: STORAGE_KEY } = size;
  // Only the desktop dock has a stored width; mobile keeps its overlay layout.
  const [width, setWidth] = useState(() => storedWidth(size));
  const root = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; width: number } | null>(null);
  const latestWidth = useRef(width);
  const previousUserSelect = useRef('');

  // Switching to or from the browser view restores that view's own width.
  useEffect(() => {
    const next = storedWidth(wide ? SIZES.wide : SIZES.normal);
    latestWidth.current = next;
    setWidth(next);
  }, [wide]);

  const updateWidth = useCallback((next: number, persist = true) => {
    const available = root.current?.parentElement?.clientWidth ?? MAX_WIDTH + 240;
    const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, available - 240));
    const clamped = Math.max(MIN_WIDTH, Math.min(maximum, Math.round(next)));
    latestWidth.current = clamped;
    setWidth(clamped);
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, String(clamped)); } catch { /* Width remains usable without storage. */ }
    }
  }, [MAX_WIDTH, STORAGE_KEY]);

  const finishDrag = useCallback(() => {
    if (!origin.current) return;
    origin.current = null;
    root.current?.removeAttribute('data-resizing');
    document.body.style.userSelect = previousUserSelect.current;
    updateWidth(latestWidth.current);
  }, [updateWidth]);

  useEffect(() => {
    if (mobile || !open || !isPresent) { finishDrag(); return; }
    const parent = root.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => updateWidth(latestWidth.current, false));
    observer.observe(parent);
    return () => {
      observer.disconnect();
      finishDrag();
    };
  }, [mobile, open, isPresent, finishDrag, updateWidth]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    origin.current = { x: event.clientX, width: latestWidth.current };
    root.current?.setAttribute('data-resizing', 'true');
    previousUserSelect.current = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (origin.current) updateWidth(origin.current.width + origin.current.x - event.clientX, false);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishDrag();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    updateWidth(event.key === 'Home' ? DEFAULT_WIDTH : latestWidth.current + (event.key === 'ArrowLeft' ? 16 : -16));
  };

  if (!isPresent) return null;
  // A display:contents wrapper lets the mobile overlay animate without consuming chat space.
  if (mobile) return <div className="workspace-mobile-inspector" {...presenceProps}>{children}</div>;
  return <div className="workspace-inspector-dock" {...presenceProps} ref={root} style={{ width: open ? width : 0 }}>
    <div role="separator" aria-orientation="vertical" aria-label={t('workspace.inspector.resize')}
      aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0}
      className="workspace-inspector-resize" onPointerDown={startDrag} onPointerMove={moveDrag}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={finishDrag}
      onDoubleClick={() => updateWidth(DEFAULT_WIDTH)} onKeyDown={onKeyDown} />
    <div className="workspace-inspector-clip">{children}</div>
  </div>;
}

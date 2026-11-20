import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import type { ComposerMenuAnchor } from '@/shared/types';


const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;

/**
 * Positions a composer popover above its trigger; Add uses start alignment, model/permission menus use end.
 *
 * Anchoring with `right`/`bottom` rather than `left`/`top` lets the menu grow
 * upward from its requested alignment without measuring itself first, so it never paints in the
 * wrong spot for a frame. The same anchor works on phones because `maxWidth`
 * shrinks the menu instead of letting it run off the left edge.
 */
export function useComposerMenuAnchor(
  isOpen: boolean,
  onClose: () => void,
  preferredWidth = 320,
  alignment: 'start' | 'end' = 'end',
) {
  const presence = useSurfacePresence(isOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Placement follows the visual viewport, including mobile zoom and the on-screen keyboard.
  const [anchor, setAnchor] = useState<ComposerMenuAnchor | null>(null);

  useLayoutEffect(() => {
    // A selection/Escape restores the trigger; an outside click keeps the user's new focus target.
    if (!isOpen && menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
  }, [isOpen]);

  const updateAnchor = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const availableWidth = Math.max(1, width - VIEWPORT_MARGIN * 2);
    const menuWidth = Math.min(preferredWidth, availableWidth);
    // Move the complete panel right if the trigger is near the viewport's left edge.
    const preferredRight = alignment === 'start' ? rect.left + menuWidth : rect.right;
    const menuRight = Math.min(left + width - VIEWPORT_MARGIN,
      Math.max(left + VIEWPORT_MARGIN + menuWidth, preferredRight));
    const menuBottom = Math.max(top + VIEWPORT_MARGIN,
      Math.min(rect.top - MENU_GAP, top + height - VIEWPORT_MARGIN));
    setAnchor({
      right: window.innerWidth - menuRight,
      bottom: window.innerHeight - menuBottom,
      maxHeight: Math.max(1, menuBottom - top - VIEWPORT_MARGIN),
      maxWidth: menuWidth,
    });
  }, [preferredWidth, alignment]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        onClose();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.visualViewport?.addEventListener('resize', updateAnchor);
    window.visualViewport?.addEventListener('scroll', updateAnchor);
    // Textarea growth and resizing the side panels can move the trigger without a window resize.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateAnchor);
    const composer = triggerRef.current?.closest('.chat-composer-shell');
    if (composer) observer?.observe(composer);
    updateAnchor();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.visualViewport?.removeEventListener('resize', updateAnchor);
      window.visualViewport?.removeEventListener('scroll', updateAnchor);
      observer?.disconnect();
    };
  }, [isOpen, onClose, updateAnchor]);

  return { triggerRef, menuRef, anchor, updateAnchor, ...presence };
}

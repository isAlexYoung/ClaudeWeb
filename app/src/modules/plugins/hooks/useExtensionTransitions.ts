import { useLayoutEffect, useRef } from 'react';

/** Used by the extension page to animate cards between enabled/disabled groups without moving keyboard focus. */
export function useExtensionTransitions(membership: string) {
  // Positions from the previous committed list let cards animate even across different groups.
  const positions = useRef(new Map<string, { x: number; y: number }>());
  // Owns the list geometry; positions are relative to it so scrolling does not cause false moves.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    const next = new Map<string, { x: number; y: number }>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.querySelectorAll<HTMLElement>('[data-extension-id]').forEach(card => {
      const id = card.dataset.extensionId!;
      const rect = card.getBoundingClientRect();
      const point = { x: rect.left - bounds.left, y: rect.top - bounds.top };
      next.set(id, point);
      if (reduced || typeof card.animate !== 'function') return;
      const previous = positions.current.get(id);
      if (previous && (previous.x !== point.x || previous.y !== point.y)) {
        card.animate([{ transform: `translate(${previous.x - point.x}px, ${previous.y - point.y}px)` }, { transform: 'translate(0, 0)' }], { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      } else if (!previous) {
        card.animate([{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
      }
    });
    positions.current = next;
  }, [membership]);
  return listRef;
}

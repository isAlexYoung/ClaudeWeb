import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
};
const snapshot = () => window.matchMedia?.(query).matches ?? false;

/** Used by surface presence and workspace view motion, including live OS preference changes. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

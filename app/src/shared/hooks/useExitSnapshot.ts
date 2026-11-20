import { useState } from 'react';

/** Menus/dialogs retain their last open content when a parent clears the selection during exit. */
export function useExitSnapshot<T>(value: T, open: boolean) {
  // The closing render no longer has the selected content; its last open snapshot is essential for exit.
  const [snapshot, setSnapshot] = useState<T>(() => value);
  // A guarded render update keeps the snapshot atomic with props, including interrupted React renders.
  if (open && !Object.is(snapshot, value)) setSnapshot(() => value);
  return open ? value : snapshot;
}

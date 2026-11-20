/** Used by useChatSessionState for search, turn-rail and bottom jumps, including rows whose lazy height changes in flight. */
export function animateTranscriptScroll(container: HTMLElement, destination: () => number, onFinish: () => void): () => void {
  const behavior = container.style.scrollBehavior;
  const anchoring = container.style.overflowAnchor;
  container.style.scrollBehavior = 'auto';
  container.style.overflowAnchor = 'none';
  let frame = 0;
  let cancelled = false;
  const restore = () => { container.style.scrollBehavior = behavior; container.style.overflowAnchor = anchoring; };
  const target = () => Math.max(0, Math.min(container.scrollHeight - container.clientHeight, destination()));
  const cancel = () => { cancelled = true; cancelAnimationFrame(frame); restore(); };
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    container.scrollTop = target(); restore(); onFinish(); return cancel;
  }
  let start = container.scrollTop;
  let startedAt = performance.now();
  let duration = 720;
  let corrections = 0;
  const tick = (now: number) => {
    if (cancelled) return;
    const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    container.scrollTop = start + (target() - start) * eased;
    if (progress < 1) { frame = requestAnimationFrame(tick); return; }
    // Give newly visible lazy rows another frame to measure, then ease any remaining correction.
    frame = requestAnimationFrame(next => {
      if (cancelled) return;
      if (Math.abs(target() - container.scrollTop) > 2 && corrections++ < 2) {
        start = container.scrollTop; startedAt = next; duration = 260; frame = requestAnimationFrame(tick);
      } else { restore(); onFinish(); }
    });
  };
  frame = requestAnimationFrame(tick);
  return cancel;
}

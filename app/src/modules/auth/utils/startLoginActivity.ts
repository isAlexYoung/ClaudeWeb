type ActivityOptions = {
  renew: () => Promise<Response>;
  isBusy?: () => boolean;
  onExpired?: () => void;
};

/** Used by the WebDesktop login hook: input and active work renew idle time;
 * ordinary API/status polling and merely keeping a tab open never do.
 */
export function startLoginActivity({ renew, isBusy = () => false, onExpired = () => window.location.reload() }: ActivityOptions) {
  let stopped = false, inFlight = false, pending = true, revision = 0;
  let lastSent = Number.NEGATIVE_INFINITY;
  const tick = async () => {
    if (stopped || inFlight || (!pending && !isBusy()) || Date.now() - lastSent < 30_000) return;
    inFlight = true;lastSent = Date.now();const sentRevision = revision;
    try {
      const response = await renew();
      if (stopped) return;
      if (response.status === 401) { stopped = true;onExpired(); }
      else if (response.status === 404) stopped = true; // Older gateways have no idle endpoint.
      else if (response.ok && revision === sentRevision) pending = false;
    } catch { /* A failed network request is not proof of logout; retry pending input. */ }
    finally { inFlight = false; }
  };
  const input = (event: Event) => {
    if (!event.isTrusted) return;
    pending = true;revision++;void tick();
  };
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  for (const event of events) window.addEventListener(event, input, { passive: true, capture: true });
  const timer = window.setInterval(() => void tick(), 30_000);
  void tick();
  return () => {
    stopped = true;window.clearInterval(timer);
    for (const event of events) window.removeEventListener(event, input, true);
  };
}

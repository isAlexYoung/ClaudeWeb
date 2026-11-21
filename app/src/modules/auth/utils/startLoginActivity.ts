type ActivityOptions = {
  renew: () => Promise<Response>;
  isBusy?: () => boolean;
};

/**
 * Used by the auth module's login activity hook: input and active work renew a
 * browser login's idle time; ordinary API polling and merely keeping a tab open
 * never do. A rejected renewal (signed out meanwhile) is handled by the API
 * helper, which ends the session on the page.
 */
export function startLoginActivity({ renew, isBusy = () => false }: ActivityOptions) {
  let stopped = false, inFlight = false, pending = true, revision = 0;
  let lastSent = Number.NEGATIVE_INFINITY;
  const tick = async () => {
    if (stopped || inFlight || (!pending && !isBusy()) || Date.now() - lastSent < 30_000) return;
    inFlight = true; lastSent = Date.now(); const sentRevision = revision;
    try {
      const response = await renew();
      if (stopped) return;
      if (response.status === 401) stopped = true;
      else if (response.ok && revision === sentRevision) pending = false;
    } catch { /* A failed network request is not proof of logout; retry pending input. */ }
    finally { inFlight = false; }
  };
  const input = (event: Event) => {
    if (!event.isTrusted) return;
    pending = true; revision++; void tick();
  };
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'];
  for (const event of events) window.addEventListener(event, input, { passive: true, capture: true });
  const timer = window.setInterval(() => void tick(), 30_000);
  void tick();
  return () => {
    stopped = true; window.clearInterval(timer);
    for (const event of events) window.removeEventListener(event, input, true);
  };
}

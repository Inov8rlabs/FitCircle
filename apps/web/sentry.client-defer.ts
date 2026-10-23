/**
 * Which pages start the browser Sentry SDK late, and how late.
 *
 * Public marketing pages (the ad landing page, the get-the-app handoff,
 * invite/join landings, legal pages) defer `Sentry.init` until the visitor
 * first interacts, or until the browser is idle after `load` (at most a few
 * seconds), so the SDK's setup work never competes with the first paint.
 *
 * Trade-off (accepted): an error thrown on one of these pages before init runs
 * is not reported. They are static, server-rendered pages with little client
 * code. Every other route (the signed-in app) initialises immediately exactly
 * as before. Server and edge Sentry are untouched (sentry.server/edge.config).
 */

const EXACT = new Set(['/', '/get', '/open', '/welcome/app', '/privacy', '/terms']);
const PREFIXES = ['/privacy/', '/terms/', '/i/', '/join/'];

export function isDeferredSentryPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return EXACT.has(p) || PREFIXES.some((prefix) => p.startsWith(prefix));
}

const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Runs `start` once: on the first interaction, or when the browser is idle
 * after `load` (falling back to a timeout), whichever comes first.
 */
export function runWhenIdleOrInteracted(start: () => void, opts: { idleTimeoutMs?: number; win?: Window } = {}): void {
  const win = opts.win ?? window;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 3000;
  let done = false;
  const cleanup = () => {
    for (const e of INTERACTION_EVENTS) win.removeEventListener(e, fire, true);
    win.removeEventListener('load', onLoad);
  };
  function fire() {
    if (done) return;
    done = true;
    cleanup();
    start();
  }
  function onLoad() {
    const ric = (win as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(fire, { timeout: idleTimeoutMs });
    else win.setTimeout(fire, Math.min(idleTimeoutMs, 1500));
  }
  for (const e of INTERACTION_EVENTS) win.addEventListener(e, fire, { capture: true, passive: true, once: true });
  if (win.document.readyState === 'complete') onLoad();
  else win.addEventListener('load', onLoad, { once: true });
}

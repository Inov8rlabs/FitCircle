/**
 * Stripe checkout context for the purchase funnel. Stripe Checkout is a full
 * page redirect, so the paywall `source` is kept in sessionStorage (same tab,
 * same origin) and read back on /upgrade/success or the cancel return to
 * /upgrade. This is checkout context, not queued analytics events.
 */
import type { Plan } from './events.generated';
import { planFromProductId } from './helpers';

const KEY = 'fc_checkout_context';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SOURCE_TOKEN = /^[a-z0-9_]{1,40}$/;

export interface CheckoutContext {
  plan: Plan;
  source: string;
}

/** Web purchases go through Stripe; product_id names the web product by plan. */
export function webProductId(plan: Plan): string {
  return `stripe_pro_${plan}`;
}

/** Normalises a `?source=` query value into a safe token. */
export function paywallSource(raw: string | null | undefined, fallback = 'pricing_page'): string {
  const value = (raw ?? '').trim().toLowerCase();
  return SOURCE_TOKEN.test(value) ? value : fallback;
}

export function rememberCheckout(context: CheckoutContext): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...context, at: Date.now() }));
  } catch {
    // Storage unavailable (private mode): the return page falls back to defaults.
  }
}

/** Reads and clears the stored context. `planHint` (from the return URL) wins for the plan. */
export function takeCheckout(planHint?: string | null): CheckoutContext | null {
  let stored: Partial<CheckoutContext> & { at?: number } = {};
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (raw) stored = JSON.parse(raw) as typeof stored;
  } catch {
    stored = {};
  }
  const fresh = typeof stored.at === 'number' && Date.now() - stored.at < MAX_AGE_MS;
  const plan = planFromProductId(planHint) ?? (fresh ? planFromProductId(stored.plan) : undefined);
  if (!plan) return null;
  return { plan, source: fresh ? paywallSource(stored.source) : 'pricing_page' };
}

/** Fires once per Stripe session id (survives reloads of the success page). */
export function firstTimeFor(sessionId: string | null): boolean {
  if (!sessionId) return true;
  const key = `fc_checkout_done_${sessionId}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    // ignore
  }
  return true;
}

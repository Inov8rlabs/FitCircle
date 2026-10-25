/**
 * Unit economics for the ads console (docs/ADS_CONSOLE_SPEC.md §5). Pure: no
 * I/O, no clock reads (callers pass `today`). Every ratio is null when its
 * denominator is 0 (rendered "—").
 */
import { addDays, diffDays } from './dates';
import type { AdMetricRow, AdsMetrics, AttributionRow } from './types';

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Revenue (subscription_events → net USD)
// ---------------------------------------------------------------------------

/** A subscription_events row (raw = the RevenueCat event object). */
export interface RevenueEvent {
  id?: string;
  user_id: string | null;
  type: string;
  store: string | null;
  environment: string | null;
  event_timestamp: string | null;
  raw: Record<string, any> | null;
}

const REVENUE_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']);
const PAYER_TYPES = new Set(['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL']);

/** Store take-home when RevenueCat didn't send takehome_percentage. */
export function fallbackTakehome(store: string | null | undefined): number {
  return String(store ?? '').toUpperCase() === 'STRIPE' ? 0.97 : 0.85;
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Gross USD price on the event (RevenueCat `price` is USD; refunds are negative). */
function grossUsd(e: RevenueEvent): number {
  const raw = e.raw ?? {};
  const price = finite(raw.price);
  if (price !== null) return price;
  if (String(raw.currency ?? '').toUpperCase() === 'USD') return finite(raw.price_in_purchased_currency) ?? 0;
  return 0;
}

export function isRefund(e: RevenueEvent): boolean {
  const raw = e.raw ?? {};
  if (e.type === 'CANCELLATION' && String(raw.cancel_reason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT') return true;
  return e.type === 'REFUND' || raw.type === 'charge.refunded';
}

/** Only PRODUCTION events count. */
export const isProduction = (e: RevenueEvent) => String(e.environment ?? e.raw?.environment ?? '').toUpperCase() === 'PRODUCTION';

/** Net revenue in USD for one event: price × takehome; refunds subtract. Non-revenue events → 0. */
export function netRevenue(e: RevenueEvent): number {
  if (!isProduction(e)) return 0;
  const raw = e.raw ?? {};
  const pct = finite(raw.takehome_percentage);
  const takehome = pct !== null && pct > 0 && pct <= 1 ? pct : fallbackTakehome(e.store ?? raw.store);
  if (isRefund(e)) {
    let gross = Math.abs(grossUsd(e));
    if (gross === 0 && raw.type === 'charge.refunded') gross = Math.abs(finite(raw.amount_refunded) ?? 0) / 100;
    return -round2(gross * takehome);
  }
  if (!REVENUE_TYPES.has(e.type)) return 0;
  return round2(Math.max(0, grossUsd(e)) * takehome);
}

export function eventTime(e: RevenueEvent): number | null {
  const t = e.event_timestamp ? Date.parse(e.event_timestamp) : NaN;
  if (Number.isFinite(t)) return t;
  const ms = finite(e.raw?.purchased_at_ms) ?? finite(e.raw?.event_timestamp_ms);
  return ms ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Per-user outcomes
// ---------------------------------------------------------------------------

export interface CohortUser {
  /** Why this sign-up is not a real customer (lib/ads/test-users.ts), else null/absent. */
  testReason?: import('./test-users').TestUserReason | null;
  userId: string;
  /** profiles.created_at (ISO). */
  signupAt: string;
  /** Cohort day (report time zone). */
  signupDate: string;
  attribution: AttributionRow | null;
  /** Earliest food log / check-in after sign-up (ISO), or null. */
  firstActivityAt: string | null;
  events: RevenueEvent[];
}

export interface UserOutcome {
  activated: boolean;
  trial: boolean;
  payer: boolean;
  revenueD7: number;
  revenueD30: number;
  revenueToDate: number;
}

export function userOutcome(u: CohortUser): UserOutcome {
  const signup = Date.parse(u.signupAt);
  const act = u.firstActivityAt ? Date.parse(u.firstActivityAt) : NaN;
  const activated = Number.isFinite(act) && Number.isFinite(signup) && act - signup <= 7 * DAY_MS;
  let trial = false;
  let payer = false;
  let d7 = 0;
  let d30 = 0;
  let all = 0;
  for (const e of u.events) {
    if (!isProduction(e)) continue;
    const net = netRevenue(e);
    if (e.type === 'INITIAL_PURCHASE' && String(e.raw?.period_type ?? '').toUpperCase() === 'TRIAL') trial = true;
    if (PAYER_TYPES.has(e.type) && net > 0) payer = true;
    if (net === 0) continue;
    all += net;
    const t = eventTime(e);
    if (t !== null && Number.isFinite(signup)) {
      if (t - signup < 7 * DAY_MS) d7 += net;
      if (t - signup < 30 * DAY_MS) d30 += net;
    }
  }
  return { activated, trial, payer, revenueD7: round2(d7), revenueD30: round2(d30), revenueToDate: round2(all) };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface DeliveryTotals {
  spend: number;
  currency: string;
  mixedCurrency: boolean;
  impressions: number;
  taps: number;
  installs: number;
}

export const emptyDelivery = (): DeliveryTotals => ({ spend: 0, currency: 'USD', mixedCurrency: false, impressions: 0, taps: 0, installs: 0 });

export function addDelivery(acc: DeliveryTotals, r: Pick<AdMetricRow, 'spend' | 'currency' | 'impressions' | 'taps' | 'installs'>): DeliveryTotals {
  const currency = (r.currency || 'USD').toUpperCase();
  acc.spend = round2(acc.spend + (Number(r.spend) || 0));
  if (currency !== 'USD' && (Number(r.spend) || 0) !== 0) acc.mixedCurrency = true;
  acc.impressions += Number(r.impressions) || 0;
  acc.taps += Number(r.taps) || 0;
  acc.installs += Number(r.installs) || 0;
  return acc;
}

export function sumDelivery(rows: Array<Pick<AdMetricRow, 'spend' | 'currency' | 'impressions' | 'taps' | 'installs'>>): DeliveryTotals {
  return rows.reduce(addDelivery, emptyDelivery());
}

// ---------------------------------------------------------------------------
// Slice metrics
// ---------------------------------------------------------------------------

export const ratio = (n: number, d: number): number | null => (d > 0 && Number.isFinite(n) ? n / d : null);

/**
 * Cohort windows are incomplete until the last cohort day + window has fully
 * passed: a user who signed up late on `rangeEnd` has until rangeEnd + N.
 */
export function incompleteFlags(rangeEnd: string, today: string) {
  const age = diffDays(rangeEnd, today);
  return { activated: age < 8, d7: age < 8, d30: age < 31 };
}

export function computeMetrics(delivery: DeliveryTotals, outcomes: UserOutcome[], ctx: { rangeEnd: string; today: string }): AdsMetrics {
  const users = outcomes.length;
  let activated = 0;
  let trials = 0;
  let payers = 0;
  let r7 = 0;
  let r30 = 0;
  let rAll = 0;
  for (const o of outcomes) {
    if (o.activated) activated += 1;
    if (o.trial) trials += 1;
    if (o.payer) payers += 1;
    r7 += o.revenueD7;
    r30 += o.revenueD30;
    rAll += o.revenueToDate;
  }
  const spend = delivery.spend;
  return {
    spend,
    currency: delivery.currency,
    mixedCurrency: delivery.mixedCurrency,
    impressions: delivery.impressions,
    taps: delivery.taps,
    installs: delivery.installs,
    users,
    activated,
    trials,
    payers,
    revenueD7: round2(r7),
    revenueD30: round2(r30),
    revenueToDate: round2(rAll),
    cpt: ratio(spend, delivery.taps),
    ttr: ratio(delivery.taps, delivery.impressions),
    cpi: ratio(spend, delivery.installs),
    costPerUser: ratio(spend, users),
    costPerActivated: ratio(spend, activated),
    costPerPayer: ratio(spend, payers),
    roasD7: ratio(r7, spend),
    roasD30: ratio(r30, spend),
    roasToDate: ratio(rAll, spend),
    installToUser: ratio(users, delivery.installs),
    userToActivated: ratio(activated, users),
    userToPayer: ratio(payers, users),
    incomplete: incompleteFlags(ctx.rangeEnd, ctx.today),
  };
}

/** Cumulative to-date ROAS per day (null until there is spend). */
export function cumulativeRoas(points: Array<{ spend: number; revenue: number }>): Array<number | null> {
  let s = 0;
  let r = 0;
  return points.map((p) => {
    s += p.spend;
    r += p.revenue;
    return ratio(r, s);
  });
}

/** The default range when none is given: last 7 days including today. */
export const defaultRange = (today: string) => ({ start: addDays(today, -6), end: today });

/**
 * Unit economics for the ads console (docs/ADS_CONSOLE_SPEC.md §5). Pure: no
 * I/O, no clock reads (callers pass `today`). Every ratio is null when its
 * denominator is 0 (rendered "—").
 */
import { addDays, diffDays } from './dates';
import type { TestUserReason } from './test-users';
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

/** Charges: money collected from the customer (trial conversions arrive as RENEWAL). */
const CHARGE_TYPES = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE']);

/** Store take-home when RevenueCat sent neither tax/commission percentages nor takehome_percentage. */
export function fallbackTakehome(store: string | null | undefined): number {
  return String(store ?? '').toUpperCase() === 'STRIPE' ? 0.97 : 0.85;
}

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Only PRODUCTION events count. */
export const isProduction = (e: RevenueEvent) => String(e.environment ?? e.raw?.environment ?? '').toUpperCase() === 'PRODUCTION';

/**
 * Stripe's own webhook events (subscription_events ids `stripe:<evt>`, raw = a
 * Stripe Event object) are audit-only: RevenueCat reports the same web
 * purchases / refunds as store = STRIPE events, so counting both would double.
 */
export const isStripeNative = (e: RevenueEvent) => String(e.id ?? '').startsWith('stripe:') || e.raw?.object === 'event';

export type RevenueKind = 'charge' | 'refund' | 'refund_reversal' | 'none';
export type RateSource = 'tax_commission' | 'takehome' | 'fallback';
export type ExcludedReason = 'sandbox' | 'stripe_native' | 'family_share' | 'trial' | 'promotional' | 'not_revenue';

export interface ClassifiedEvent {
  kind: RevenueKind;
  /** Positive gross USD amount (tax-inclusive, as RevenueCat reports `price`); 0 when unknown. */
  grossUsd: number;
  /** True when the event should carry money but no usable USD price was sent. */
  missingPrice: boolean;
  /** Share of gross we keep (1 − tax − commission). */
  rate: number;
  rateSource: RateSource;
  /** Signed net USD (charges +, refunds −), rounded to cents. */
  net: number;
  excluded: ExcludedReason | null;
}

/**
 * RevenueCat `price` is the USD price of the transaction (null if unknown, 0 for
 * free trials, negative for refunds). Falls back to price_in_purchased_currency
 * only when that currency is USD.
 */
function usdPrice(raw: Record<string, any>): number | null {
  const price = finite(raw.price);
  if (price !== null) return price;
  if (String(raw.currency ?? '').toUpperCase() === 'USD') return finite(raw.price_in_purchased_currency);
  return null;
}

/**
 * Share of the gross price we keep. RevenueCat: proceeds = price × (1 −
 * tax_percentage − commission_percentage), both fractions of the gross
 * (tax-inclusive) price. takehome_percentage is deprecated but equivalent; the
 * store fallback is used only when neither is present (it ignores tax).
 */
export function takehomeRate(raw: Record<string, any>, store: string | null | undefined): { rate: number; source: RateSource } {
  const tax = finite(raw.tax_percentage);
  const commission = finite(raw.commission_percentage);
  if (commission !== null && commission >= 0 && commission < 1) {
    const t = tax !== null && tax >= 0 ? tax : 0;
    if (t + commission < 1) return { rate: 1 - t - commission, source: 'tax_commission' };
  }
  const pct = finite(raw.takehome_percentage);
  if (pct !== null && pct > 0 && pct <= 1) return { rate: pct, source: 'takehome' };
  return { rate: fallbackTakehome(store), source: 'fallback' };
}

const NONE = (excluded: ExcludedReason | null, rate = 1, rateSource: RateSource = 'fallback'): ClassifiedEvent => ({
  kind: 'none',
  grossUsd: 0,
  missingPrice: false,
  rate,
  rateSource,
  net: 0,
  excluded,
});

/** What one subscription_events row is worth (pure; the single source of revenue rules). */
export function classifyEvent(e: RevenueEvent): ClassifiedEvent {
  if (!isProduction(e)) return NONE('sandbox');
  if (isStripeNative(e)) return NONE('stripe_native');
  const raw = e.raw ?? {};
  const store = e.store ?? raw.store ?? null;
  const price = usdPrice(raw);
  const { rate, source } = takehomeRate(raw, store);

  let kind: RevenueKind = 'none';
  if (CHARGE_TYPES.has(e.type)) kind = 'charge';
  else if (e.type === 'CANCELLATION' && ((price !== null && price < 0) || String(raw.cancel_reason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT')) kind = 'refund';
  else if (e.type === 'REFUND_REVERSED') kind = 'refund_reversal';
  if (kind === 'none') return NONE('not_revenue', rate, source);

  // Family Sharing: the organiser's purchase is the one that was paid; the member's copy is not revenue.
  if (raw.is_family_share === true) return NONE('family_share', rate, source);
  if (String(store ?? '').toUpperCase() === 'PROMOTIONAL') return NONE('promotional', rate, source);
  if (kind === 'charge' && String(raw.period_type ?? '').toUpperCase() === 'TRIAL') return NONE('trial', rate, source);

  const gross = price === null ? 0 : Math.abs(price);
  // A charge with a negative price is not a charge we can trust; treat as unknown.
  const bad = price === null || (kind === 'charge' && price < 0);
  const amount = bad ? 0 : round2(gross * rate);
  return {
    kind,
    grossUsd: bad ? 0 : gross,
    missingPrice: price === null,
    rate,
    rateSource: source,
    net: kind === 'refund' ? -amount : amount,
    excluded: null,
  };
}

/** Net revenue in USD for one event: price × (1 − tax − commission); refunds subtract. Non-revenue events → 0. */
export function netRevenue(e: RevenueEvent): number {
  return classifyEvent(e).net;
}

export function isRefund(e: RevenueEvent): boolean {
  return classifyEvent(e).kind === 'refund';
}

export function eventTime(e: RevenueEvent): number | null {
  const t = e.event_timestamp ? Date.parse(e.event_timestamp) : NaN;
  if (Number.isFinite(t)) return t;
  const ms = finite(e.raw?.event_timestamp_ms) ?? finite(e.raw?.purchased_at_ms);
  return ms ?? null;
}

/**
 * Identity of the money movement an event represents, so a store transaction is
 * counted at most once even if it arrives under two event ids (re-delivery after
 * a restore / transfer / alias, or the same receipt under two users).
 * Purchase and refund of one transaction share transaction_id, so the kind is
 * part of the key. Non-revenue events key by event id.
 */
export function moneyKey(e: RevenueEvent): string {
  const c = classifyEvent(e);
  const raw = e.raw ?? {};
  const tx = raw.transaction_id ?? null;
  if (c.kind !== 'none' && tx !== null && tx !== undefined && tx !== '') return `${c.kind}:${String(e.store ?? raw.store ?? '').toUpperCase()}:${tx}`;
  return `id:${e.id ?? JSON.stringify([e.type, e.event_timestamp, raw.id ?? null])}`;
}

/** Drop duplicate deliveries (same event id, or same transaction + kind). Keeps the earliest. */
export function dedupeEvents(events: RevenueEvent[]): { events: RevenueEvent[]; dropped: number } {
  const sorted = [...events].sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const out: RevenueEvent[] = [];
  let dropped = 0;
  for (const e of sorted) {
    const key = moneyKey(e);
    if ((e.id && seenIds.has(e.id)) || seenKeys.has(key)) {
      dropped += 1;
      continue;
    }
    if (e.id) seenIds.add(e.id);
    seenKeys.add(key);
    out.push(e);
  }
  return { events: out, dropped };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Per-user outcomes
// ---------------------------------------------------------------------------

export interface CohortUser {
  /** Why this sign-up is not a real customer (lib/ads/test-users.ts), else null/absent. */
  testReason?: TestUserReason | null;
  userId: string;
  /** profiles.created_at (ISO). */
  signupAt: string;
  /** Cohort day (report time zone). */
  signupDate: string;
  attribution: AttributionRow | null;
  /** Earliest food log / manual check-in after sign-up (ISO), or null. */
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

/** Windows are half-open: [signup, signup + N days). Same rule for activation and revenue. */
export const ACTIVATION_DAYS = 7;
const inWindow = (t: number, signup: number, days: number) => t - signup < days * DAY_MS;

export function userOutcome(u: CohortUser): UserOutcome {
  const signup = Date.parse(u.signupAt);
  const act = u.firstActivityAt ? Date.parse(u.firstActivityAt) : NaN;
  const activated = Number.isFinite(act) && Number.isFinite(signup) && inWindow(act, signup, ACTIVATION_DAYS);
  let trial = false;
  let paidCharges = 0;
  let netRefunds = 0;
  let d7 = 0;
  let d30 = 0;
  let all = 0;
  for (const e of dedupeEvents(u.events).events) {
    const c = classifyEvent(e);
    if (c.excluded === 'trial' && e.type === 'INITIAL_PURCHASE') trial = true;
    if (c.kind === 'charge' && (c.grossUsd > 0 || c.missingPrice)) paidCharges += 1;
    if (c.kind === 'refund') netRefunds += 1;
    if (c.kind === 'refund_reversal') netRefunds -= 1;
    if (c.net === 0) continue;
    all += c.net;
    const t = eventTime(e);
    if (t !== null && Number.isFinite(signup)) {
      if (inWindow(t, signup, 7)) d7 += c.net;
      if (inWindow(t, signup, 30)) d30 += c.net;
    }
  }
  // A payer has at least one paid charge that was not refunded.
  const payer = paidCharges - Math.max(0, netRefunds) > 0;
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
  // Sum in cents so totals never depend on grouping order.
  acc.spend = (Math.round(acc.spend * 100) + Math.round((Number(r.spend) || 0) * 100)) / 100;
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

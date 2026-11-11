/**
 * Recurring-revenue types (pure): which plan a RevenueCat charge belongs to, cash collected by plan,
 * and the MRR / ARR run-rate as of an instant.
 *
 * Plans (FitCircle Pro, 2026-11): monthly $9.99 (com.inov8rlabs.fitcircle.pro.monthly; Play
 * `…monthly:monthly`), annual $29.99 paid upfront (…pro.annual; Play `…annual:annual`), the same
 * annual product billed in 12 MONTHLY installments (App Store "annual, paid monthly" price rows,
 * e.g. CA$3.99 / £2.99), lifetime $179.99 (…pro.lifetime, one-time), web purchases via Stripe
 * (Stripe product ids prod_VMJ7… monthly, prod_VMJ9… annual, prod_VMJA… lifetime).
 *
 * RevenueCat sends no installment flag (verified on every raw key in subscription_events,
 * 2026-11-10). An annual-product charge is classed as installments when its billing period
 * (expiration_at_ms − purchased_at_ms) is about a month, upfront when about a year; a Play base
 * plan id containing "install" is installments too. Sandbox clocks are compressed (Apple: 1 month
 * = 5 min, 1 year = 1 h; Play: 5 / 30 min) and mapped back to days.
 */
import { classifyEvent, dedupeEvents, eventTime, type RevenueEvent } from '../ads/metrics';

export type Plan = 'monthly' | 'annual_upfront' | 'annual_installments' | 'lifetime' | 'other';
export type RevenueStore = 'app_store' | 'play_store' | 'stripe' | 'other';
export const PLANS: Plan[] = ['monthly', 'annual_upfront', 'annual_installments', 'lifetime', 'other'];
export const REVENUE_STORES: RevenueStore[] = ['app_store', 'play_store', 'stripe', 'other'];

export const STRIPE_PRODUCT_PLAN: Record<string, 'monthly' | 'annual' | 'lifetime'> = {
  prod_VMJ7HLtSdA2OB9: 'monthly',
  prod_VMJ9kSPmFHVHNn: 'annual',
  prod_VMJA0YWFSi31mS: 'lifetime',
};

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 365.25 / 12;
const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Billing period of the event in days (sandbox clocks mapped back to real periods), or null. */
export function billingPeriodDays(e: RevenueEvent): number | null {
  const raw = e.raw ?? {};
  const purchased = finite(raw.purchased_at_ms);
  const expires = finite(raw.expiration_at_ms);
  if (purchased === null || expires === null || expires <= purchased) return null;
  const ms = expires - purchased;
  const env = String(e.environment ?? raw.environment ?? '').toUpperCase();
  if (env && env !== 'PRODUCTION') {
    const min = ms / 60_000;
    if (min <= 12) return AVG_MONTH_DAYS;
    if (min >= 20 && min <= 120) return 365;
    return ms / DAY_MS;
  }
  return ms / DAY_MS;
}

export function storeOf(e: RevenueEvent): RevenueStore {
  const s = String(e.store ?? e.raw?.store ?? '').toUpperCase();
  if (s === 'APP_STORE' || s === 'MAC_APP_STORE') return 'app_store';
  if (s === 'PLAY_STORE') return 'play_store';
  if (s === 'STRIPE' || s === 'RC_BILLING') return 'stripe';
  return 'other';
}

/** Plan of one charge (or refund) event. */
export function planOf(e: RevenueEvent): Plan {
  const raw = e.raw ?? {};
  const product = String(raw.product_id ?? '').toLowerCase();
  const stripe = STRIPE_PRODUCT_PLAN[String(raw.product_id ?? '')];
  if (e.type === 'NON_RENEWING_PURCHASE' || product.includes('lifetime') || stripe === 'lifetime') return 'lifetime';
  const period = billingPeriodDays(e);
  if (product.includes('install')) return 'annual_installments';
  if (product.includes('annual') || product.includes('year') || stripe === 'annual') {
    return period !== null && period <= 45 ? 'annual_installments' : 'annual_upfront';
  }
  if (product.includes('month') || stripe === 'monthly') return 'monthly';
  if (period !== null) {
    if (period >= 25 && period <= 35) return 'monthly';
    if (period >= 300) return 'annual_upfront';
  }
  return 'other';
}

export interface PlanMoney {
  gross: number;
  net: number;
  charges: number;
}

/**
 * Cash collected per day and plan (and store), test users dropped by `include`. Signed like
 * subscriptionRevenueByDay: refunds subtract from gross and net; `charges` counts paid charges.
 * A refund takes the plan of the charge it refunds (same transaction id) when known.
 */
export function cashByDayAndPlan(
  events: RevenueEvent[],
  dayOf: (iso: string) => string,
  include: (userId: string | null) => boolean = () => true
): Map<string, { byPlan: Map<Plan, PlanMoney>; byStore: Map<RevenueStore, PlanMoney> }> {
  const deduped = dedupeEvents(events).events;
  const planByTx = new Map<string, Plan>();
  for (const e of deduped) {
    const tx = e.raw?.transaction_id;
    if (tx && classifyEvent(e).kind === 'charge') planByTx.set(String(tx), planOf(e));
  }
  const out = new Map<string, { byPlan: Map<Plan, PlanMoney>; byStore: Map<RevenueStore, PlanMoney> }>();
  for (const e of deduped) {
    if (!include(e.user_id)) continue;
    const c = classifyEvent(e);
    if (!c.net || !e.event_timestamp) continue;
    const day = dayOf(e.event_timestamp);
    const tx = e.raw?.transaction_id ? String(e.raw.transaction_id) : null;
    const plan = c.kind === 'charge' ? planOf(e) : (tx && planByTx.get(tx)) || planOf(e);
    const store = storeOf(e);
    const gross = c.kind === 'refund' ? -c.grossUsd : c.grossUsd;
    const slot = out.get(day) ?? { byPlan: new Map(), byStore: new Map() };
    for (const [m, k] of [
      [slot.byPlan, plan],
      [slot.byStore, store],
    ] as const) {
      const prev = (m as Map<string, PlanMoney>).get(k) ?? { gross: 0, net: 0, charges: 0 };
      (m as Map<string, PlanMoney>).set(k, { gross: round2(prev.gross + gross), net: round2(prev.net + c.net), charges: prev.charges + (c.kind === 'charge' ? 1 : 0) });
    }
    out.set(day, slot);
  }
  return out;
}

export interface Money {
  gross: number;
  net: number;
}

export interface RecurringSnapshot {
  /** The instant the snapshot describes (ISO). */
  asOf: string;
  /** Normalized monthly recurring run-rate: monthly price, annual ÷ 12, installment price (= annual commitment ÷ 12). Lifetime and trials excluded. */
  mrr: Money;
  /** mrr × 12. */
  arr: Money;
  activePaidSubs: { monthly: number; annual_upfront: number; annual_installments: number; other: number; total: number };
  /** Contracted annual value of active annual subscriptions (upfront price, or installment × 12), even when paid monthly. */
  annualCommittedContractValue: Money;
  /** Installments of active annual-installment commitments not billed yet. */
  annualInstallmentsUnbilled: Money;
  /** Subscriptions cancelled (auto-renew off) but not yet expired; still counted as active. */
  cancelledPendingExpiry: number;
  trialsActive: number;
  /** Users holding a paid, unrefunded lifetime purchase (no recurring revenue). */
  lifetimeOwners: number;
  notes: string[];
}

const subKey = (userId: string, e: RevenueEvent) => `${userId}|${e.raw?.original_transaction_id ?? String(e.raw?.product_id ?? '')}`;

/**
 * Run-rate as of `at` (epoch ms) from every PRODUCTION event of every user (pure).
 *  - A subscription is active when its latest paid, unrefunded charge at or before `at` has
 *    expiration_at_ms > `at` and no EXPIRATION event followed it. Cancelled-but-not-expired is
 *    still active (counted in cancelledPendingExpiry).
 *  - Trials are excluded from MRR; an unexpired trial with no paid charge counts in trialsActive.
 *  - Amounts are the USD price RevenueCat reports on the charge; net = price × the charge's
 *    take-home rate (after store commission and tax).
 */
export function recurringAsOf(eventsByUser: Map<string, RevenueEvent[]>, at: number, include: (userId: string) => boolean = () => true): RecurringSnapshot {
  const snap: RecurringSnapshot = {
    asOf: new Date(at).toISOString(),
    mrr: { gross: 0, net: 0 },
    arr: { gross: 0, net: 0 },
    activePaidSubs: { monthly: 0, annual_upfront: 0, annual_installments: 0, other: 0, total: 0 },
    annualCommittedContractValue: { gross: 0, net: 0 },
    annualInstallmentsUnbilled: { gross: 0, net: 0 },
    cancelledPendingExpiry: 0,
    trialsActive: 0,
    lifetimeOwners: 0,
    notes: [],
  };
  const lifetimeUsers = new Set<string>();
  let unknownPeriod = 0;
  for (const [userId, all] of eventsByUser) {
    if (!include(userId)) continue;
    const events = dedupeEvents(all)
      .events.filter((e) => String(e.environment ?? e.raw?.environment ?? '').toUpperCase() === 'PRODUCTION')
      .filter((e) => (eventTime(e) ?? Infinity) <= at);
    const refunded = new Set<string>();
    for (const e of events) {
      const c = classifyEvent(e);
      if (c.kind === 'refund' && e.raw?.transaction_id) refunded.add(String(e.raw.transaction_id));
      if (c.kind === 'refund_reversal' && e.raw?.transaction_id) refunded.delete(String(e.raw.transaction_id));
    }
    const subs = new Map<string, RevenueEvent[]>();
    for (const e of events) {
      const k = subKey(userId, e);
      subs.set(k, [...(subs.get(k) ?? []), e]);
    }
    for (const list of subs.values()) {
      list.sort((a, b) => (eventTime(a) ?? 0) - (eventTime(b) ?? 0));
      const paid = list.filter((e) => {
        const c = classifyEvent(e);
        return c.kind === 'charge' && c.grossUsd > 0 && !refunded.has(String(e.raw?.transaction_id ?? ''));
      });
      const last = paid[paid.length - 1];
      if (!last) {
        const trial = [...list].reverse().find((e) => classifyEvent(e).excluded === 'trial');
        const exp = finite(trial?.raw?.expiration_at_ms);
        const expired = trial && list.some((e) => e.type === 'EXPIRATION' && (eventTime(e) ?? 0) >= (eventTime(trial) ?? 0));
        if (trial && exp !== null && exp > at && !expired) snap.trialsActive += 1;
        continue;
      }
      const plan = planOf(last);
      if (plan === 'lifetime') {
        lifetimeUsers.add(userId);
        continue;
      }
      const exp = finite(last.raw?.expiration_at_ms);
      const tLast = eventTime(last) ?? 0;
      const expiredEvent = list.some((e) => e.type === 'EXPIRATION' && (eventTime(e) ?? 0) > tLast);
      if (exp === null || exp <= at || expiredEvent) continue;
      const c = classifyEvent(last);
      const price = c.grossUsd;
      let monthly: number;
      if (plan === 'monthly' || plan === 'annual_installments') monthly = price;
      else if (plan === 'annual_upfront') monthly = price / 12;
      else {
        const period = billingPeriodDays(last);
        if (period === null) unknownPeriod += 1;
        monthly = period ? (price * AVG_MONTH_DAYS) / period : price;
      }
      snap.activePaidSubs[plan] += 1;
      snap.activePaidSubs.total += 1;
      snap.mrr.gross += monthly;
      snap.mrr.net += monthly * c.rate;
      if (list.some((e) => e.type === 'CANCELLATION' && classifyEvent(e).kind !== 'refund' && (eventTime(e) ?? 0) > tLast)) snap.cancelledPendingExpiry += 1;
      if (plan === 'annual_upfront') {
        snap.annualCommittedContractValue.gross += price;
        snap.annualCommittedContractValue.net += price * c.rate;
      }
      if (plan === 'annual_installments') {
        snap.annualCommittedContractValue.gross += price * 12;
        snap.annualCommittedContractValue.net += price * 12 * c.rate;
        const billedInCycle = ((paid.filter((e) => planOf(e) === 'annual_installments').length - 1) % 12) + 1;
        const remaining = 12 - billedInCycle;
        snap.annualInstallmentsUnbilled.gross += remaining * price;
        snap.annualInstallmentsUnbilled.net += remaining * price * c.rate;
      }
    }
  }
  snap.lifetimeOwners = lifetimeUsers.size;
  const r = (m: Money): Money => ({ gross: round2(m.gross), net: round2(m.net) });
  snap.mrr = r(snap.mrr);
  snap.arr = { gross: round2(snap.mrr.gross * 12), net: round2(snap.mrr.net * 12) };
  snap.annualCommittedContractValue = r(snap.annualCommittedContractValue);
  snap.annualInstallmentsUnbilled = r(snap.annualInstallmentsUnbilled);
  snap.notes.push('Active = latest paid, unrefunded charge not yet expired (cancelled-but-not-expired counts until expiration). Trials and lifetime purchases are excluded from MRR. USD prices as RevenueCat reports them; net = price × store take-home rate.');
  snap.notes.push('Annual installments vs upfront is inferred from the billing period of the charge (RevenueCat sends no installment flag); installments billed so far are counted per 12-month commitment from the subscription’s paid installment charges.');
  if (unknownPeriod) snap.notes.push(`${unknownPeriod} active subscription(s) of an unknown plan had no billing period; their full price is counted as monthly.`);
  return snap;
}

/** Net cash per user and plan for events whose day (`dayOf`) passes `inRange` (refunds take the refunded charge's plan). */
export function netByUserAndPlan(events: RevenueEvent[], dayOf: (iso: string) => string, inRange: (day: string) => boolean): Map<string, Partial<Record<Plan, number>>> {
  const deduped = dedupeEvents(events).events;
  const planByTx = new Map<string, Plan>();
  for (const e of deduped) if (e.raw?.transaction_id && classifyEvent(e).kind === 'charge') planByTx.set(String(e.raw.transaction_id), planOf(e));
  const out = new Map<string, Partial<Record<Plan, number>>>();
  for (const e of deduped) {
    if (!e.user_id || !e.event_timestamp) continue;
    const c = classifyEvent(e);
    if (!c.net || !inRange(dayOf(e.event_timestamp))) continue;
    const tx = e.raw?.transaction_id ? String(e.raw.transaction_id) : null;
    const plan = c.kind === 'charge' ? planOf(e) : (tx && planByTx.get(tx)) || planOf(e);
    const row = out.get(e.user_id) ?? {};
    row[plan] = round2((row[plan] ?? 0) + c.net);
    out.set(e.user_id, row);
  }
  return out;
}

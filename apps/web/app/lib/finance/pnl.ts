/**
 * P&L (pure): revenue (subscriptions net/gross, AdMob estimate) − costs (UA spend + AI model spend)
 * per day / week / month. Inputs are loaded by FinanceReportService.
 *
 * Day clocks (never silently mixed; stated in notes): subscriptions, UA spend, sign-ups and DAU use
 * the report time zone; AdMob reports Pacific days; AI gateway days are UTC. Each source's day is
 * placed in the period whose calendar dates contain it.
 */
import { addDays, eachDay } from '../ads/dates';

import { type PlanMoney, PLANS, type RecurringSnapshot, REVENUE_STORES } from './recurring';
import type { Plan, PnlGrain, PnlLines, PnlReport, RevenueStore } from './types';

export const PNL_GRAINS: PnlGrain[] = ['day', 'week', 'month'];

export interface PnlAiDay {
  day: string;
  production: number;
  testUsers: number;
  evalDev: number;
  unattributed: number;
}

export interface PnlInput {
  range: { start: string; end: string; timeZone: string };
  grain: PnlGrain;
  now: Date;
  subscriptions: Map<string, { net: number; gross: number; charges: number }>;
  /** AdMob estimated earnings per Pacific day; null when AdMob is not connected. */
  adRevenue: Map<string, number> | null;
  /** Campaign-level spend rows (ad_metrics_daily level='campaign'). */
  ua: Array<{ date: string; channel: string; spend: number }>;
  ai: PnlAiDay[];
  newUsers: Map<string, number>;
  newPayers: Map<string, number>;
  dau: Map<string, number>;
  /** Cash by report-tz day, by plan and by store (lib/finance/recurring.ts cashByDayAndPlan). */
  cash: Map<string, { byPlan: Map<Plan, PlanMoney>; byStore: Map<RevenueStore, PlanMoney> }>;
  /** Recurring snapshot at an instant (epoch ms). */
  recurringAt: (at: number) => RecurringSnapshot;
  notes?: string[];
}

/** The instant a report-tz calendar day ends (next local midnight), as epoch ms. */
export function endOfDayInstant(day: string, tz: string): number {
  const next = addDays(day, 1);
  const guess = Date.parse(`${next}T00:00:00Z`);
  // Offset of tz at that instant: local wall clock − UTC.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return guess - (local - guess);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Periods covering [start, end], clipped to the range. */
export function periodsFor(start: string, end: string, grain: PnlGrain): Array<{ start: string; end: string; label: string }> {
  const out: Array<{ start: string; end: string; label: string }> = [];
  if (grain === 'day') return eachDay(start, end).map((d) => ({ start: d, end: d, label: d }));
  let cursor = start;
  while (cursor <= end && out.length < 1000) {
    let pEnd: string;
    let label: string;
    if (grain === 'week') {
      const ws = weekStart(cursor);
      pEnd = addDays(ws, 6);
      label = `Week of ${ws}`;
    } else {
      const [y, m] = cursor.split('-').map(Number);
      const next = new Date(Date.UTC(y, m, 1)); // first day of next month
      pEnd = addDays(next.toISOString().slice(0, 10), -1);
      label = cursor.slice(0, 7);
    }
    if (pEnd > end) pEnd = end;
    out.push({ start: cursor, end: pEnd, label });
    cursor = addDays(pEnd, 1);
  }
  return out;
}

const sumMap = (m: Map<string, number> | null, s: string, e: string): number => {
  if (!m) return 0;
  let t = 0;
  for (const [d, v] of m) if (d >= s && d <= e) t += v;
  return t;
};

function lines(p: { start: string; end: string; label: string }, input: PnlInput): Omit<PnlLines, 'cumulativeNet'> {
  const inP = (d: string) => d >= p.start && d <= p.end;
  const planAcc = new Map<Plan, PlanMoney>();
  const storeAcc = new Map<RevenueStore, PlanMoney>();
  for (const [d, v] of input.cash) {
    if (!inP(d)) continue;
    for (const [acc, src] of [
      [planAcc, v.byPlan],
      [storeAcc, v.byStore],
    ] as const) {
      for (const [k, m] of src as Map<string, PlanMoney>) {
        const prev = (acc as Map<string, PlanMoney>).get(k) ?? { gross: 0, net: 0, charges: 0 };
        (acc as Map<string, PlanMoney>).set(k, { gross: round2(prev.gross + m.gross), net: round2(prev.net + m.net), charges: prev.charges + m.charges });
      }
    }
  }
  const byPlan = PLANS.map((plan) => ({ plan, ...(planAcc.get(plan) ?? { gross: 0, net: 0, charges: 0 }) }));
  const byStore = REVENUE_STORES.map((store) => ({ store, ...(storeAcc.get(store) ?? { gross: 0, net: 0, charges: 0 }) }));
  const asOf = Math.min(input.now.getTime(), endOfDayInstant(p.end, input.range.timeZone));
  let gross = 0;
  let net = 0;
  for (const [d, v] of input.subscriptions) {
    if (!inP(d)) continue;
    gross += v.gross;
    net += v.net;
  }
  const ad = input.adRevenue ? round2(sumMap(input.adRevenue, p.start, p.end)) : null;
  const subscriptionNet = round2(net);
  const subscriptionGross = round2(gross);
  const totalNet = round2(subscriptionNet + (ad ?? 0));

  const byChannel = { apple_ads: 0, google_ads: 0, meta: 0 };
  let other = 0;
  for (const r of input.ua) {
    if (!inP(r.date)) continue;
    const cents = Math.round((Number(r.spend) || 0) * 100);
    if (r.channel in byChannel) byChannel[r.channel as keyof typeof byChannel] += cents;
    else other += cents;
  }
  const ua = {
    total: (byChannel.apple_ads + byChannel.google_ads + byChannel.meta + other) / 100,
    byChannel: { apple_ads: byChannel.apple_ads / 100, google_ads: byChannel.google_ads / 100, meta: byChannel.meta / 100 },
  };

  const ai = { production: 0, testUsers: 0, evalDev: 0, unattributed: 0, total: 0 };
  for (const d of input.ai) {
    if (!inP(d.day)) continue;
    ai.production += d.production;
    ai.testUsers += d.testUsers;
    ai.evalDev += d.evalDev;
    ai.unattributed += d.unattributed;
  }
  ai.total = ai.production + ai.testUsers + ai.evalDev + ai.unattributed;
  const aiOut = { production: round4(ai.production), testUsers: round4(ai.testUsers), evalDev: round4(ai.evalDev), unattributed: round4(ai.unattributed), total: round4(ai.total) };

  const costsTotal = round4(ua.total + ai.total);
  const periodNet = round4(totalNet - costsTotal);

  const newUsers = sumMap(input.newUsers, p.start, p.end);
  const dauDays = [...input.dau].filter(([d, v]) => inP(d) && v > 0);
  const userDays = dauDays.reduce((s, [, v]) => s + v, 0);
  return {
    start: p.start,
    end: p.end,
    label: p.label,
    revenue: { subscriptionGross, storeFeesAndTax: round2(subscriptionGross - subscriptionNet), subscriptionNet, byPlan, byStore, adRevenue: ad, totalNet },
    costs: { ua, ai: aiOut, total: costsTotal },
    net: periodNet,
    margin: totalNet !== 0 ? round4(periodNet / totalNet) : null,
    kpis: {
      newUsers,
      payers: sumMap(input.newPayers, p.start, p.end),
      dauAvg: dauDays.length ? Math.round((userDays / dauDays.length) * 10) / 10 : null,
      cac: newUsers > 0 ? round2(ua.total / newUsers) : null,
      aiCostPerDau: userDays > 0 ? round6(ai.production / userDays) : null,
    },
    recurring: input.recurringAt(asOf),
  };
}

export const PNL_DEFINITIONS: Record<string, string> = {
  subscriptionGross: 'What subscribers paid (RevenueCat production events: App Store, Google Play, web), refunds subtracted, test users excluded. Cash basis: booked on the event day.',
  storeFeesAndTax: 'Gross − net: store commission plus sales tax / VAT the store withholds.',
  subscriptionNet: 'Net proceeds after store commission and tax, refunds subtracted.',
  byPlan: 'Cash collected = what was billed in the period, split by plan: monthly; annual paid upfront; annual paid in monthly installments (App Store annual billing plan — told apart by the charge’s billing period, RevenueCat sends no flag); lifetime (one-time, never recurring); other. Sums to subscription gross / net.',
  byStore: 'Cash collected by store: App Store, Google Play, Stripe (web), other.',
  mrr: 'MRR/ARR = normalized recurring run-rate, not cash: active paid subscriptions at the period end, monthly price + annual price ÷ 12 + installment price (the annual commitment ÷ 12). Lifetime and trials excluded. Cancelled-but-not-expired subscriptions count until they expire. Gross = list price paid (USD as RevenueCat reports it); net = after store commission and tax.',
  arr: 'ARR = MRR × 12 (run-rate, not a forecast).',
  annualCommittedContractValue: 'Annual committed = contracted annual value of active annual subscriptions, even if paid monthly (upfront price, or installment × 12).',
  annualInstallmentsUnbilled: 'Installments of active annual-installment commitments that have not been billed yet.',
  trialsActive: 'Unexpired free trials with no paid charge yet (not revenue, not in MRR).',
  adRevenue: 'ESTIMATE: AdMob estimated earnings (revised by AdMob until the month is finalised). Null when AdMob is not connected.',
  totalNet: 'Net subscription revenue + AdMob estimated earnings.',
  ua: 'Paid user-acquisition spend as reported by the ad networks (ad_metrics_daily, campaign level).',
  ai: 'AI model spend billed by the Vercel AI Gateway (account-wide), split into production (real users + system jobs), test users, eval/dev and unattributed. The total is everything billed.',
  costsTotal: 'UA spend + AI model spend. Excludes Vercel hosting, Supabase, Apple/Google developer fees, email, payroll and other operating costs.',
  net: 'Total net revenue − total costs above.',
  margin: 'Net ÷ total net revenue (null when revenue is 0).',
  cumulativeNet: 'Running sum of net from the start of the range.',
  newUsers: 'Sign-ups (profiles created) in the period, test / internal accounts excluded (report time zone).',
  payers: 'Users whose first paid subscription charge fell in the period (test users excluded).',
  dauAvg: 'Average distinct daily active users (Amplitude user actions / home_feed_decisions / app_opens, test users excluded) over days with activity data.',
  cac: 'UA spend ÷ new users (blended: organic sign-ups included).',
  aiCostPerDau: 'Production AI spend ÷ Σ daily active users in the period.',
};

export function buildPnlReport(input: PnlInput): PnlReport {
  const periods = periodsFor(input.range.start, input.range.end, input.grain);
  let cumulative = 0;
  const out: PnlLines[] = periods.map((p) => {
    const l = lines(p, input);
    cumulative = round4(cumulative + l.net);
    return { ...l, cumulativeNet: cumulative };
  });
  const whole = lines({ start: input.range.start, end: input.range.end, label: 'Total' }, input);
  const notes = [...(input.notes ?? [])];
  notes.push(`Days: subscriptions, UA spend, sign-ups and DAU use ${input.range.timeZone}; AdMob uses Pacific days; AI gateway costs use UTC days. A source's day is counted in the period that contains its date (no re-bucketing across clocks).`);
  notes.push('Not in total cost: Vercel hosting, Supabase, Apple / Google developer fees, email, domains, payroll and other operating costs. AI costs are account-wide gateway spend, including eval/dev and unattributed lines.');
  if (!input.adRevenue) notes.push('AdMob is not connected: ad revenue is shown as null, not 0.');
  else notes.push('AdMob revenue is an estimate until AdMob finalises the month.');
  return {
    range: input.range,
    grain: input.grain,
    generatedAt: input.now.toISOString(),
    periods: out,
    totals: { ...whole, cumulativeNet: whole.net },
    recurring: whole.recurring,
    definitions: PNL_DEFINITIONS,
    notes,
  };
}

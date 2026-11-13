/**
 * PMF scorecard math. PURE: the service (lib/pmf/services/pmf-service.ts) loads facts; this computes every KPI for
 * the current and previous window, 12 weekly trend buckets, platform / channel segments and the PMF score.
 * No clock reads (facts carry `now` / `today`). Never estimates: a KPI without data is null, a KPI we do not
 * collect is `not_measured`.
 *
 * Windows (report time zone calendar days):
 *  - activity KPIs:  [today − P, today − 1] (today is partial, so excluded)
 *  - cohort KPIs:    sign-ups in [today − M − P, today − M − 1], M = the KPI's maturity in days, so every sign-up
 *                    in the window has had its full window (per-user eligibility is still checked)
 *  - previous:       the same window shifted back by P days
 *  - trend:          12 consecutive 7-day buckets ending at the current window's end
 */
import { addDays, diffDays, eachDay, ymdInTz } from '../ads/dates';
import { classifyEvent, dedupeEvents, eventTime, userOutcome, type RevenueEvent } from '../ads/metrics';
import { AD_CHANNELS } from '../ads/types';
import { endOfDayInstant } from '../finance/pnl';
import { recurringAsOf } from '../finance/recurring';

import { KPI_DEFS, LOW_SAMPLE_N, MIN_STATUS_N, PMF_SCORE_BANDS, type KpiDef } from './catalog';
import type { KpiSegments, KpiStatus, KpiThreshold, KpiTrendPoint, KpiValue, KpiWindow, PmfKpi, PmfPeriod, PmfScore, PmfScoreComponent, SegmentDimension } from './types';

const DAY_MS = 86_400_000;
const GRACE_MS = 60_000;
const TREND_WEEKS = 12;

export type PmfPlatform = 'ios' | 'android' | 'web' | 'unknown';
export const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web', unknown: 'Unknown' };
export const CHANNEL_LABEL: Record<string, string> = {
  apple_ads: 'Apple Ads',
  google_ads: 'Google Ads',
  meta: 'Meta',
  organic: 'Organic',
  invite: 'Friend invite',
  unknown: 'Unknown',
};
const PAID = new Set<string>(AD_CHANNELS);
export const isPaidChannel = (c: string) => PAID.has(c);

export interface PmfUserVirality {
  invited: boolean;
  invitesSent: number;
  invitesJoined: number;
  friends: number;
  sociallyActivated: boolean;
}

/** One real sign-up (test / robot accounts already removed). */
export interface PmfUser {
  userId: string;
  signupAt: string;
  /** Sign-up day in the report time zone. */
  signupDate: string;
  /** IANA zone used for the user's own calendar days (retention). */
  timezone: string;
  platform: PmfPlatform;
  /** invite | apple_ads | google_ads | meta | organic | unknown */
  channel: string;
  onboardingCompleted: boolean;
  reachedPaywall: boolean;
  /** First meal logged by the user (not an import), any time. */
  firstMealAt: string | null;
  /** PRODUCTION RevenueCat events of the user. */
  events: RevenueEvent[];
  virality: PmfUserVirality | null;
}

export interface PmfMembership {
  userId: string;
  circleId: string;
  /** [start, end) epoch ms; end = Infinity while still a member. */
  start: number;
  end: number;
}

export interface PmfFacts {
  now: Date;
  /** Today in the report time zone. */
  today: string;
  timeZone: string;
  users: PmfUser[];
  /** Activity instants (epoch ms) of every real user: app opens, Home feed loads, logged meals. */
  activity: Map<string, number[]>;
  /** Logged-meal instants of every real user. */
  meals: Map<string, number[]>;
  /** Platform of every real user seen in activity (else their sign-up platform). */
  userPlatform: Map<string, PmfPlatform>;
  /** Campaign-level ad spend per report day and channel. */
  spend: Array<{ date: string; channel: string; spend: number }>;
  /** PRODUCTION events of every real user (subscription state, trials). */
  eventsByUser: Map<string, RevenueEvent[]>;
  /** Memberships of real users in private, live circles (public / demo / cancelled / draft circles removed). */
  memberships: PmfMembership[];
  /** Start of the activity signal (first synced Amplitude hour, else first Home feed load / app open); retention only counts sign-ups after it. */
  activitySince: string | null;
}

export interface Filter {
  platform?: string;
  channel?: string;
}

interface Calc {
  value: number | null;
  n: number;
  numerator: number | null;
}

const round = (v: number | null, dp = 1): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const pct = (num: number, den: number): number | null => (den > 0 ? round((num / den) * 100, 1) : null);
const per = (num: number, den: number, dp = 2): number | null => (den > 0 ? round(num / den, dp) : null);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export function currentWindow(today: string, period: PmfPeriod, maturityDays: number | null): KpiWindow {
  const end = addDays(today, -((maturityDays ?? 0) + 1));
  return { start: addDays(end, -(period - 1)), end };
}

export const shift = (w: KpiWindow, days: number): KpiWindow => ({ start: addDays(w.start, days), end: addDays(w.end, days) });

export function trendBuckets(end: string): KpiWindow[] {
  const out: KpiWindow[] = [];
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    const e = addDays(end, -7 * i);
    out.push({ start: addDays(e, -6), end: e });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-user helpers
// ---------------------------------------------------------------------------

export function hasTrial(events: RevenueEvent[]): boolean {
  return events.some((e) => e.type === 'INITIAL_PURCHASE' && classifyEvent(e).excluded === 'trial');
}

/** Context with caches built once per report. */
export class PmfContext {
  private localDays = new Map<string, Set<string>>();
  private reportDays: Map<string, Set<string>> | null = null;
  private mealDays: Map<string, Set<string>> | null = null;
  private readonly signalMs: number | null;
  readonly userById: Map<string, PmfUser>;

  constructor(readonly facts: PmfFacts) {
    this.signalMs = facts.activitySince ? Date.parse(facts.activitySince) : null;
    this.userById = new Map(facts.users.map((u) => [u.userId, u]));
  }

  get nowMs() {
    return this.facts.now.getTime();
  }

  /** The user's active calendar days in their own time zone. */
  activeLocalDays(u: PmfUser): Set<string> {
    let s = this.localDays.get(u.userId);
    if (!s) {
      s = new Set((this.facts.activity.get(u.userId) ?? []).map((t) => ymdInTz(t, u.timezone)));
      this.localDays.set(u.userId, s);
    }
    return s;
  }

  /** day (report tz) → users active that day. */
  activeByDay(): Map<string, Set<string>> {
    if (!this.reportDays) {
      const m = new Map<string, Set<string>>();
      for (const [userId, ts] of this.facts.activity) {
        for (const t of ts) {
          const d = ymdInTz(t, this.facts.timeZone);
          let s = m.get(d);
          if (!s) m.set(d, (s = new Set()));
          s.add(userId);
        }
      }
      this.reportDays = m;
    }
    return this.reportDays;
  }

  /** user → report-tz days with a logged meal. */
  mealDaysByUser(): Map<string, Set<string>> {
    if (!this.mealDays) {
      const m = new Map<string, Set<string>>();
      for (const [userId, ts] of this.facts.meals) m.set(userId, new Set(ts.map((t) => ymdInTz(t, this.facts.timeZone))));
      this.mealDays = m;
    }
    return this.mealDays;
  }

  cohort(w: KpiWindow, f: Filter): PmfUser[] {
    return this.facts.users.filter((u) => u.signupDate >= w.start && u.signupDate <= w.end && (!f.platform || u.platform === f.platform) && (!f.channel || u.channel === f.channel));
  }

  platformOf(userId: string): string {
    return this.facts.userPlatform.get(userId) ?? this.userById.get(userId)?.platform ?? 'unknown';
  }

  /** Retained on local day signup+n; null = not eligible (window not over, or signed up before the signal). */
  retained(u: PmfUser, n: number): boolean | null {
    const signup = Date.parse(u.signupAt);
    if (this.signalMs === null || signup < this.signalMs) return null;
    const day = addDays(ymdInTz(signup, u.timezone), n);
    if (ymdInTz(this.nowMs, u.timezone) <= day) return null;
    return this.activeLocalDays(u).has(day);
  }

  matured(u: PmfUser, days: number): boolean {
    return this.nowMs - Date.parse(u.signupAt) >= days * DAY_MS;
  }

  activated(u: PmfUser): boolean {
    if (!u.firstMealAt) return false;
    const d = Date.parse(u.firstMealAt) - Date.parse(u.signupAt);
    return d >= -GRACE_MS && d < 7 * DAY_MS;
  }

  spend(w: KpiWindow, channel?: string): number {
    let s = 0;
    for (const r of this.facts.spend) if (r.date >= w.start && r.date <= w.end && (!channel || r.channel === channel)) s += r.spend;
    return Math.round(s * 100) / 100;
  }

  activeUsers(start: string, end: string, f: Filter): Set<string> {
    const out = new Set<string>();
    const byDay = this.activeByDay();
    for (const d of eachDay(start, end)) for (const id of byDay.get(d) ?? []) if (this.passes(id, f)) out.add(id);
    return out;
  }

  passes(userId: string, f: Filter): boolean {
    if (f.platform && this.platformOf(userId) !== f.platform) return false;
    if (f.channel && (this.userById.get(userId)?.channel ?? 'unknown') !== f.channel) return false;
    return true;
  }

  startInstant(day: string) {
    return endOfDayInstant(addDays(day, -1), this.facts.timeZone);
  }

  endInstant(day: string) {
    return endOfDayInstant(day, this.facts.timeZone);
  }
}

// ---------------------------------------------------------------------------
// KPI calculators
// ---------------------------------------------------------------------------

type Calculator = (ctx: PmfContext, w: KpiWindow, f: Filter) => Calc;

const rate = (users: PmfUser[], eligible: (u: PmfUser) => boolean, success: (u: PmfUser) => boolean): Calc => {
  const el = users.filter(eligible);
  const num = el.filter(success).length;
  return { value: pct(num, el.length), n: el.length, numerator: num };
};

const retention =
  (n: number): Calculator =>
  (ctx, w, f) => {
    const flags = ctx.cohort(w, f).map((u) => ctx.retained(u, n)).filter((r): r is boolean => r !== null);
    const num = flags.filter(Boolean).length;
    return { value: pct(num, flags.length), n: flags.length, numerator: num };
  };

const paidUsers = (ctx: PmfContext, w: KpiWindow, f: Filter) => ctx.cohort(w, f).filter((u) => isPaidChannel(u.channel));

const CALCULATORS: Record<string, Calculator> = {
  d1_retention: retention(1),
  d7_retention: retention(7),
  d30_retention: retention(30),
  activation_first_meal: (ctx, w, f) => rate(ctx.cohort(w, f), (u) => ctx.matured(u, 7), (u) => ctx.activated(u)),
  time_to_first_meal: (ctx, w, f) => {
    const hours = ctx
      .cohort(w, f)
      .filter((u) => ctx.matured(u, 7) && ctx.activated(u))
      .map((u) => Math.max(0, Date.parse(u.firstMealAt!) - Date.parse(u.signupAt)) / 3_600_000);
    return { value: round(median(hours), 2), n: hours.length, numerator: null };
  },
  onboarding_completion: (ctx, w, f) => rate(ctx.cohort(w, f), () => true, (u) => u.onboardingCompleted),
  social_activation: (ctx, w, f) => rate(ctx.cohort(w, f), (u) => !!u.virality && ctx.matured(u, 7), (u) => !!u.virality?.sociallyActivated),
  k_factor: (ctx, w, f) => {
    const el = ctx.cohort(w, f).filter((u) => !!u.virality && ctx.matured(u, 7));
    const friends = el.reduce((s, u) => s + (u.virality?.friends ?? 0), 0);
    return { value: per(friends, el.length, 3), n: el.length, numerator: friends };
  },
  invite_rate: (ctx, w, f) => rate(ctx.cohort(w, f), (u) => !!u.virality && ctx.matured(u, 7), (u) => !!u.virality?.invited),
  invite_join_rate: (ctx, w, f) => {
    const el = ctx.cohort(w, f).filter((u) => !!u.virality);
    const sent = el.reduce((s, u) => s + (u.virality?.invitesSent ?? 0), 0);
    const joined = el.reduce((s, u) => s + (u.virality?.invitesJoined ?? 0), 0);
    return { value: pct(joined, sent), n: sent, numerator: joined };
  },
  organic_share: (ctx, w, f) => rate(ctx.cohort(w, f), () => true, (u) => u.channel === 'organic' || u.channel === 'invite'),
  trial_start_rate: (ctx, w, f) => rate(ctx.cohort(w, f), (u) => ctx.matured(u, 7) && ctx.activated(u), (u) => hasTrial(u.events)),
  paywall_to_trial: (ctx, w, f) => rate(ctx.cohort(w, f), (u) => u.reachedPaywall && ctx.matured(u, 7), (u) => hasTrial(u.events)),
  paid_conversion: (ctx, w, f) => rate(ctx.cohort(w, f), (u) => ctx.matured(u, 7), (u) => userOutcome(asCohortUser(u)).payer),
  trial_to_paid: (ctx, w, f) => {
    let ended = 0;
    let converted = 0;
    for (const [userId, all] of ctx.facts.eventsByUser) {
      if (!ctx.passes(userId, f)) continue;
      const events = dedupeEvents(all).events;
      for (const trial of events.filter((e) => e.type === 'INITIAL_PURCHASE' && classifyEvent(e).excluded === 'trial')) {
        const start = eventTime(trial);
        if (start === null) continue;
        const day = ymdInTz(start, ctx.facts.timeZone);
        if (day < w.start || day > w.end) continue;
        const exp = Number(trial.raw?.expiration_at_ms);
        if (!Number.isFinite(exp) || exp > ctx.nowMs) continue;
        ended++;
        if (paidAfter(events, start)) converted++;
      }
    }
    return { value: pct(converted, ended), n: ended, numerator: converted };
  },
  cost_per_activated: (ctx, w, f) => {
    if (f.platform) return { value: null, n: 0, numerator: null };
    const users = paidUsers(ctx, w, f).filter((u) => ctx.matured(u, 7) && ctx.activated(u));
    const spend = ctx.spend(w, f.channel);
    return { value: per(spend, users.length), n: users.length, numerator: spend };
  },
  paid_cac: (ctx, w, f) => {
    if (f.platform) return { value: null, n: 0, numerator: null };
    const users = paidUsers(ctx, w, f);
    const spend = ctx.spend(w, f.channel);
    return { value: per(spend, users.length), n: users.length, numerator: spend };
  },
  blended_cac: (ctx, w, f) => {
    if (f.platform || f.channel) return { value: null, n: 0, numerator: null };
    const users = ctx.cohort(w, f);
    const spend = ctx.spend(w);
    return { value: per(spend, users.length), n: users.length, numerator: spend };
  },
  ltv_cac: (ctx, w, f) => {
    if (f.platform) return { value: null, n: 0, numerator: null };
    const users = paidUsers(ctx, w, f);
    const spend = ctx.spend(w, f.channel);
    const revenue = users.reduce((s, u) => s + userOutcome(asCohortUser(u)).revenueToDate, 0);
    return { value: spend > 0 ? round(revenue / spend, 2) : null, n: users.length, numerator: Math.round(revenue * 100) / 100 };
  },
  ltv_30d: (ctx, w, f) => {
    const el = ctx.cohort(w, f).filter((u) => ctx.matured(u, 30));
    const rev = el.reduce((s, u) => s + userOutcome(asCohortUser(u)).revenueD30, 0);
    return { value: per(rev, el.length), n: el.length, numerator: Math.round(rev * 100) / 100 };
  },
  dau: (ctx, w, f) => {
    const byDay = ctx.activeByDay();
    const days = eachDay(w.start, w.end);
    const total = days.reduce((s, d) => s + [...(byDay.get(d) ?? [])].filter((id) => ctx.passes(id, f)).length, 0);
    return { value: round(total / days.length, 1), n: ctx.activeUsers(w.start, w.end, f).size, numerator: null };
  },
  mau: (ctx, w, f) => {
    const n = ctx.activeUsers(addDays(w.end, -29), w.end, f).size;
    return { value: n, n, numerator: null };
  },
  stickiness: (ctx, w, f) => {
    const byDay = ctx.activeByDay();
    const ratios: number[] = [];
    for (const d of eachDay(w.start, w.end)) {
      const mau = ctx.activeUsers(addDays(d, -29), d, f).size;
      if (!mau) continue;
      const dau = [...(byDay.get(d) ?? [])].filter((id) => ctx.passes(id, f)).length;
      ratios.push(dau / mau);
    }
    const value = ratios.length ? round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100, 1) : null;
    return { value, n: ctx.activeUsers(w.start, w.end, f).size, numerator: null };
  },
  meal_logging_frequency: (ctx, w, f) => {
    const days = diffDays(w.start, w.end) + 1;
    let loggers = 0;
    let logDays = 0;
    for (const [userId, set] of ctx.mealDaysByUser()) {
      if (!ctx.passes(userId, f)) continue;
      const inWin = [...set].filter((d) => d >= w.start && d <= w.end).length;
      if (!inWin) continue;
      loggers++;
      logDays += inWin;
    }
    return { value: loggers ? round(logDays / loggers / (days / 7), 2) : null, n: loggers, numerator: null };
  },
  buddy_wau: (ctx, w, f) => {
    const weeks = Math.max(1, Math.floor((diffDays(w.start, w.end) + 1) / 7));
    let sum = 0;
    let actives = 0;
    for (let i = 0; i < weeks; i++) {
      const end = addDays(w.end, -7 * i);
      const start = addDays(end, -6);
      const active = ctx.activeUsers(start, end, {});
      const a = ctx.startInstant(start);
      const b = ctx.endInstant(end);
      const byCircle = new Map<string, Set<string>>();
      for (const m of ctx.facts.memberships) {
        if (!active.has(m.userId) || !(Math.max(a, m.start) < Math.min(b, m.end))) continue;
        let s = byCircle.get(m.circleId);
        if (!s) byCircle.set(m.circleId, (s = new Set()));
        s.add(m.userId);
      }
      const buddies = new Set<string>();
      for (const s of byCircle.values()) if (s.size >= 2) for (const id of s) buddies.add(id);
      sum += [...buddies].filter((id) => ctx.passes(id, f)).length;
      actives += [...active].filter((id) => ctx.passes(id, f)).length;
    }
    return { value: round(sum / weeks, 1), n: Math.round(actives / weeks), numerator: null };
  },
  arpu_monthly: (ctx, w, f) => {
    const mau = ctx.activeUsers(addDays(w.end, -29), w.end, f).size;
    const snap = recurringAsOf(ctx.facts.eventsByUser, ctx.endInstant(w.end), (id) => ctx.passes(id, f));
    return { value: per(snap.mrr.net, mau), n: mau, numerator: snap.mrr.net };
  },
  subscriber_churn: (ctx, w, f) => {
    const a = ctx.startInstant(w.start);
    const b = Math.min(ctx.endInstant(w.end), ctx.nowMs);
    let base = 0;
    let churned = 0;
    for (const [userId, events] of ctx.facts.eventsByUser) {
      if (!ctx.passes(userId, f)) continue;
      const one = new Map([[userId, events]]);
      if (recurringAsOf(one, a).activePaidSubs.total === 0) continue;
      base++;
      if (recurringAsOf(one, b).activePaidSubs.total === 0) churned++;
    }
    if (!base) return { value: null, n: 0, numerator: 0 };
    const days = diffDays(w.start, w.end) + 1;
    const c = churned / base;
    return { value: round((1 - (1 - c) ** (30 / days)) * 100, 1), n: base, numerator: churned };
  },
};

function paidAfter(events: RevenueEvent[], after: number): boolean {
  let charges = 0;
  let refunds = 0;
  for (const e of events) {
    const t = eventTime(e);
    if (t === null || t < after) continue;
    const c = classifyEvent(e);
    if (c.kind === 'charge' && (c.grossUsd > 0 || c.missingPrice)) charges++;
    if (c.kind === 'refund') refunds++;
    if (c.kind === 'refund_reversal') refunds--;
  }
  return charges - Math.max(0, refunds) > 0;
}

function asCohortUser(u: PmfUser) {
  return { userId: u.userId, signupAt: u.signupAt, signupDate: u.signupDate, attribution: null, firstActivityAt: null, events: u.events };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function statusOf(def: Pick<KpiDef, 'unit' | 'notMeasured'>, threshold: KpiThreshold | null, v: Calc): KpiStatus {
  if (def.notMeasured) return 'not_measured';
  if (v.value === null) {
    // Money spent with nobody to divide it by is the worst case, not "no data".
    if (def.unit === 'usd' && threshold?.direction === 'lower' && (v.numerator ?? 0) > 0) return 'off_track';
    return 'no_data';
  }
  if (def.unit !== 'count' && v.n < MIN_STATUS_N) return 'too_few';
  if (!threshold) return 'no_target';
  const { direction, target, minimum } = threshold;
  if (direction === 'higher') {
    if (v.value >= target) return 'on_track';
    if (minimum !== null ? v.value >= minimum : v.value >= target * 0.8) return 'at_risk';
    return 'off_track';
  }
  if (v.value <= target) return 'on_track';
  if (minimum !== null ? v.value <= minimum : v.value <= target * 1.25) return 'at_risk';
  return 'off_track';
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const PLATFORM_KEYS = ['ios', 'android', 'web', 'unknown'];
const CHANNEL_KEYS = ['apple_ads', 'google_ads', 'meta', 'organic', 'invite', 'unknown'];
const SPEND_KPIS = new Set(['cost_per_activated', 'paid_cac', 'ltv_cac']);
const NO_SEGMENTS = new Set(['blended_cac', 'subscriber_churn', 'arpu_monthly', 'buddy_wau']);
/** No channel split: activity KPIs (any user, not only sign-ups) and organic share (defined by channel). */
const ACTIVITY_NO_CHANNEL = new Set(['dau', 'mau', 'stickiness', 'meal_logging_frequency', 'trial_to_paid', 'organic_share']);

function segmentsFor(def: KpiDef, calc: Calculator, ctx: PmfContext, cur: KpiWindow, prev: KpiWindow): KpiSegments[] {
  if (def.notMeasured || NO_SEGMENTS.has(def.id)) return [];
  const dims: Array<{ dimension: SegmentDimension; keys: string[]; label: Record<string, string> }> = [];
  if (!SPEND_KPIS.has(def.id)) dims.push({ dimension: 'platform', keys: PLATFORM_KEYS, label: PLATFORM_LABEL });
  if (!ACTIVITY_NO_CHANNEL.has(def.id)) dims.push({ dimension: 'channel', keys: SPEND_KPIS.has(def.id) ? [...AD_CHANNELS] : CHANNEL_KEYS, label: CHANNEL_LABEL });
  return dims
    .map(({ dimension, keys, label }) => ({
      dimension,
      rows: keys
        .map((key) => {
          const f = { [dimension]: key } as Filter;
          const c = calc(ctx, cur, f);
          const p = calc(ctx, prev, f);
          return { key, label: label[key] ?? key, value: c.value, n: c.n, numerator: c.numerator, previous: { value: p.value, n: p.n, numerator: p.numerator } };
        })
        .filter((r) => r.n > 0 || r.previous.n > 0 || (SPEND_KPIS.has(def.id) && (r.numerator ?? 0) > 0)),
    }))
    .filter((s) => s.rows.length > 0);
}

// ---------------------------------------------------------------------------
// KPI assembly
// ---------------------------------------------------------------------------

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function windowLabel(def: KpiDef, w: KpiWindow): string {
  const range = `${fmtDay(w.start)} – ${fmtDay(w.end)}`;
  if (def.id === 'trial_to_paid') return `Trials started ${range} whose trial has ended`;
  if (def.id === 'subscriber_churn') return `Paid subscriptions active on ${fmtDay(w.start)}, checked on ${fmtDay(w.end)}`;
  if (def.id === 'mau' || def.id === 'arpu_monthly') return `30 days ending ${fmtDay(w.end)}`;
  if (def.maturityDays === null) return `Activity ${range}`;
  if (def.maturityDays === 0) return `Sign-ups ${range}`;
  return `Sign-ups ${range} (each needs ${def.maturityDays} day${def.maturityDays === 1 ? '' : 's'} to mature)`;
}

const NOT_MEASURED_VALUE = (w: KpiWindow): KpiValue => ({ value: null, n: 0, numerator: null, window: w });

export function buildKpi(def: KpiDef, ctx: PmfContext, period: PmfPeriod): PmfKpi {
  const cur = currentWindow(ctx.facts.today, period, def.maturityDays);
  const prev = shift(cur, -period);
  const base = {
    id: def.id,
    name: def.name,
    group: def.group,
    definition: def.definition,
    unit: def.unit,
    threshold: def.threshold,
    maturityDays: def.maturityDays ?? 0,
    windowLabel: windowLabel(def, cur),
    pmfComponent: def.pmfComponent ?? null,
    notes: [...(def.notes ?? []), ...(def.threshold?.note ? [def.threshold.note] : [])],
  };
  if (def.notMeasured) {
    return {
      ...base,
      status: 'not_measured',
      current: NOT_MEASURED_VALUE(cur),
      previous: NOT_MEASURED_VALUE(prev),
      change: null,
      trend: [],
      segments: [],
      lowSample: false,
      notMeasured: def.notMeasured,
    };
  }
  const calc = CALCULATORS[def.id];
  if (!calc) throw new Error(`No calculator for KPI ${def.id}`);
  const c = calc(ctx, cur, {});
  const p = calc(ctx, prev, {});
  const trend: KpiTrendPoint[] = trendBuckets(cur.end).map((b) => {
    // MAU / ARPU are point-in-time (30 days ending the bucket); everything else is the bucket's own 7 days.
    const r = calc(ctx, b, {});
    return { start: b.start, end: b.end, value: r.value, n: r.n };
  });
  return {
    ...base,
    status: statusOf(def, def.threshold, c),
    current: { ...c, window: cur },
    previous: { ...p, window: prev },
    change: c.value !== null && p.value !== null ? round(c.value - p.value, def.unit === 'percent' ? 1 : 2) : null,
    trend,
    segments: segmentsFor(def, calc, ctx, cur, prev),
    lowSample: def.unit !== 'count' && c.n > 0 && c.n < LOW_SAMPLE_N,
    notMeasured: null,
  };
}

export function buildKpis(facts: PmfFacts, period: PmfPeriod): PmfKpi[] {
  const ctx = new PmfContext(facts);
  return KPI_DEFS.map((d) => buildKpi(d, ctx, period));
}

// ---------------------------------------------------------------------------
// PMF score (PMF-METRICS.md "PMF Score Components")
// ---------------------------------------------------------------------------

const cap = (v: number) => Math.max(0, Math.min(100, v));

export function pmfScore(kpis: PmfKpi[]): PmfScore {
  const val = (id: string) => kpis.find((k) => k.id === id)?.current.value ?? null;
  const spec: Array<Omit<PmfScoreComponent, 'input' | 'score'> & { fn: (v: number) => number }> = [
    { key: 'retention', label: 'Retention', weight: 0.3, kpiId: 'd30_retention', formula: 'D30 retention ÷ 25% × 100', fn: (v) => (v / 25) * 100 },
    { key: 'engagement', label: 'Engagement', weight: 0.25, kpiId: 'stickiness', formula: 'DAU/MAU ÷ 50% × 100', fn: (v) => (v / 50) * 100 },
    { key: 'growth', label: 'Growth', weight: 0.2, kpiId: 'k_factor', formula: 'K ÷ 1.0 × 100 (capped at 100)', fn: (v) => (v / 1) * 100 },
    { key: 'satisfaction', label: 'Satisfaction', weight: 0.15, kpiId: 'nps', formula: '(NPS + 100) ÷ 2', fn: (v) => (v + 100) / 2 },
    { key: 'economic', label: 'Economic', weight: 0.1, kpiId: 'ltv_cac', formula: 'LTV/CAC ÷ 5 × 100', fn: (v) => (v / 5) * 100 },
  ];
  const components: PmfScoreComponent[] = spec.map(({ fn, ...s }) => {
    const input = val(s.kpiId);
    return { ...s, input, score: input === null ? null : Math.round(cap(fn(input)) * 10) / 10 };
  });
  const missing = components.filter((c) => c.score === null).map((c) => c.label);
  const value = missing.length ? null : Math.round(components.reduce((s, c) => s + c.weight * (c.score ?? 0), 0) * 10) / 10;
  const band = value === null ? null : (PMF_SCORE_BANDS.find((b) => Math.round(value) >= b.min && Math.round(value) <= b.max)?.label ?? null);
  return { value, band, components, missing, bands: PMF_SCORE_BANDS };
}

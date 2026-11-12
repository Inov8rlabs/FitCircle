/**
 * Experiment results (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §2, §6.6). Pure:
 * takes one `UserFacts` per analysed user and returns per-arm metrics with
 * Bayesian comparisons. I/O lives in results-service.ts.
 *
 * Population: randomised (reason=bucket) AND exposed users only — intent to
 * treat among the exposed. Overrides, fallback and winner rows never count.
 *
 * Maturity: a user counts toward a metric only once its window has elapsed
 * since assignment (`n` is the mature n, the UI shows "n mature").
 *
 * Rates: Beta(1 + x, 1 + n − x) posteriors, 10 000 seeded Monte Carlo draws →
 * P(best), P(> control), 90 % credible interval. Revenue/user: 2 000 seeded
 * bootstrap resamples of the per-user mean. Arms with n = 0 are left out of
 * comparisons (their fields are null).
 */
import { DEFAULT_TRIAL_DAYS } from '../config/trial';

import { betaDraws, bootstrapMeans, chiSquarePValue, compareDraws, liftIntervals, mulberry32, quantileSorted, seedFrom } from './stats';

const H = 3_600_000;
const D = 24 * H;

export const RATE_SIMULATIONS = 10_000;
export const BOOTSTRAP_RESAMPLES = 2_000;
/** Decision rule threshold (§2): P(best) and guardrail-breach probability. */
export const DECISION_PROBABILITY = 0.9;

export type SegmentDimension = 'platform' | 'channel' | 'country';

/** Everything the metrics need about one analysed user. Times are epoch ms. */
export interface UserFacts {
  userId: string;
  arm: string;
  assignedAt: number;
  platform: string | null;
  channel: string | null;
  country: string | null;
  onboardingCompletedAt: number | null;
  /** Earliest paywall timestamp on record (onboarding / aha / auto). */
  paywallViewedAt: number | null;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  trialConvertedAt: number | null;
  /** First non-trial purchase (incl. intro-priced and lifetime). */
  directPurchaseAt: number | null;
  /** First "turned off auto-renew" during the trial. */
  trialCancelledAt: number | null;
  /** First refund. */
  refundAt: number | null;
  /** USD amounts: purchases/renewals positive, refunds negative. */
  revenue: Array<{ at: number; usd: number }>;
  /** Any server-visible activity (meal/water logged, streak day claimed). */
  activityAt: number[];
  /** Meals (entry_type food) logged. */
  mealAt: number[];
  deletedAt: number | null;
}

export type MetricGroup = 'primary' | 'secondary' | 'guardrail';

/** Plain-language description of a metric, shown in Admin Tools next to its numbers. */
interface MetricCopy {
  /** Human title, e.g. "Became a paying subscriber within 14 days". */
  title: string;
  /** One-line definition: what is counted, over whom, in which window. */
  definition: string;
  /** Who counts as a success (rates) / what is summed (means). */
  numerator: string;
  /** Who is in the denominator. */
  denominator: string;
  /** Plain name for the denominator ("n"), e.g. "Users with 14 days of data". */
  maturityLabel: string;
  group: MetricGroup;
  /** Early signal for the primary metric (spec §2: trial start D1). */
  leadingIndicator?: boolean;
  /** The ship rule (§2) is evaluated on this metric. */
  decisionMetric?: boolean;
}

interface RateMetricDef extends MetricCopy {
  key: string;
  label: string;
  kind: 'rate';
  window: string;
  higherIsBetter: boolean;
  primary?: boolean;
  guardrail?: { type: 'relative' | 'absolute'; tolerance: number };
  /** null = not in this metric's denominator (yet). */
  evaluate(u: UserFacts, now: number): boolean | null;
  /** True when the user will join the denominator once their window elapses. */
  pending(u: UserFacts, now: number): boolean;
}

interface MeanMetricDef extends MetricCopy {
  key: string;
  label: string;
  kind: 'mean';
  window: string;
  higherIsBetter: boolean;
  value(u: UserFacts, now: number): number | null;
  pending(u: UserFacts, now: number): boolean;
}

const within = (t: number | null, from: number, to: number) => t !== null && t >= from && t < to;
const anyWithin = (ts: readonly number[], from: number, to: number) => ts.some((t) => t >= from && t < to);
/** Grace after a trial ends for the store's first charge (billing retries, webhook lag). */
const TRIAL_SETTLE_MS = 4 * D;
/** The store's trial end; only when unknown, start + the default trial length. Requires trialStartedAt. */
export const trialEndOf = (u: Pick<UserFacts, 'trialStartedAt' | 'trialEndsAt'>): number => u.trialEndsAt ?? u.trialStartedAt! + DEFAULT_TRIAL_DAYS * D;

/** Mature after `ms` since assignment → evaluate, else null. */
const matureAfter = (ms: number, f: (u: UserFacts) => boolean) => (u: UserFacts, now: number) => (now >= u.assignedAt + ms ? f(u) : null);
/** Not yet mature: fewer than `ms` since assignment. */
const youngerThan = (ms: number) => (u: UserFacts, now: number) => now < u.assignedAt + ms;
/** Trial started after assignment but its outcome window (trial end + `graceMs`) has not passed yet. */
const trialPending = (graceMs: number) => (u: UserFacts, now: number) =>
  u.trialStartedAt !== null && u.trialStartedAt >= u.assignedAt - H && now < trialEndOf(u) + graceMs;

export const RATE_METRICS: readonly RateMetricDef[] = [
  {
    key: 'onboarding_completed',
    title: 'Finished onboarding within 3 days',
    definition: 'Share of users who completed onboarding within 3 days of entering the experiment.',
    numerator: 'Users who completed onboarding within 3 days',
    denominator: 'Users who have been in the experiment for at least 3 days',
    maturityLabel: 'Users with 3 days of data',
    group: 'secondary',
    pending: youngerThan(3 * D),
    label: 'Onboarding completed (D3)',
    kind: 'rate',
    window: 'D3',
    higherIsBetter: true,
    evaluate: matureAfter(3 * D, (u) => within(u.onboardingCompletedAt, u.assignedAt - H, u.assignedAt + 3 * D)),
  },
  {
    key: 'paywall_viewed',
    title: 'Saw the paywall within 3 days',
    definition: 'Share of users shown a paywall (onboarding, aha moment or automatic) within 3 days.',
    numerator: 'Users who saw any paywall within 3 days',
    denominator: 'Users who have been in the experiment for at least 3 days',
    maturityLabel: 'Users with 3 days of data',
    group: 'secondary',
    pending: youngerThan(3 * D),
    label: 'Paywall viewed (D3)',
    kind: 'rate',
    window: 'D3',
    higherIsBetter: true,
    evaluate: matureAfter(3 * D, (u) => within(u.paywallViewedAt, u.assignedAt - H, u.assignedAt + 3 * D)),
  },
  {
    key: 'trial_started_d1',
    title: 'Started a free trial within 1 day',
    definition: 'Share of users who started a free trial within 24 hours. The early signal for paid conversion.',
    numerator: 'Users who started a trial within 24 hours',
    denominator: 'Users who have been in the experiment for at least 1 day',
    maturityLabel: 'Users with 1 day of data',
    group: 'secondary',
    leadingIndicator: true,
    pending: youngerThan(D),
    label: 'Trial started (D1)',
    kind: 'rate',
    window: 'D1',
    higherIsBetter: true,
    evaluate: matureAfter(D, (u) => within(u.trialStartedAt, u.assignedAt - H, u.assignedAt + D)),
  },
  {
    key: 'trial_to_paid',
    title: 'Trials that turned into paid subscriptions',
    definition: 'Of users who started a trial, the share whose trial converted to paid by 4 days after the trial ended.',
    numerator: 'Trial starters who converted to paid',
    denominator: 'Trial starters whose trial ended at least 4 days ago (store billing retries)',
    maturityLabel: 'Finished trials',
    group: 'secondary',
    pending: trialPending(TRIAL_SETTLE_MS),
    label: 'Trial → paid (trial end + 4 days)',
    kind: 'rate',
    window: 'trial+4d',
    higherIsBetter: true,
    // Denominator: users whose trial started (any time after assignment) and ended at least 4 days
    // ago (store billing retries). The end is the store's (trialEndsAt), so 3- and 7-day trials both
    // work; for a 3-day trial this is the old "7 days after trial start" window.
    evaluate: (u, now) => {
      if (u.trialStartedAt === null || u.trialStartedAt < u.assignedAt - H) return null;
      const settled = trialEndOf(u) + TRIAL_SETTLE_MS;
      if (now < settled) return null;
      return within(u.trialConvertedAt, u.trialStartedAt, settled);
    },
  },
  {
    key: 'paid_conversion_d14',
    title: 'Became a paying subscriber within 14 days',
    definition: 'Share of users whose trial converted to paid, or who bought directly, within 14 days of entering the experiment.',
    numerator: 'Users with a paid conversion (trial converted or direct purchase) within 14 days',
    denominator: 'Users who have been in the experiment for at least 14 days',
    maturityLabel: 'Users with 14 days of data',
    group: 'primary',
    pending: youngerThan(14 * D),
    label: 'Paid conversion (D14)',
    kind: 'rate',
    window: 'D14',
    higherIsBetter: true,
    primary: true,
    // D14 = up to a 7-day trial started in the first days + store billing retries + reporting lag.
    evaluate: matureAfter(14 * D, (u) =>
      within(u.trialConvertedAt, u.assignedAt - H, u.assignedAt + 14 * D) || within(u.directPurchaseAt, u.assignedAt - H, u.assignedAt + 14 * D)
    ),
  },
  {
    key: 'retention_d1',
    title: 'Came back the next day (day-1 retention)',
    definition: 'Share of users active (logged food or water, or claimed a streak day) 24–48 hours after entering.',
    numerator: 'Users active on day 1',
    denominator: 'Users who have been in the experiment for at least 2 days',
    maturityLabel: 'Users with 2 days of data',
    group: 'guardrail',
    pending: youngerThan(2 * D),
    label: 'D1 retention',
    kind: 'rate',
    window: 'D1',
    higherIsBetter: true,
    guardrail: { type: 'relative', tolerance: 0.15 },
    evaluate: matureAfter(2 * D, (u) => anyWithin(u.activityAt, u.assignedAt + D, u.assignedAt + 2 * D)),
  },
  {
    key: 'retention_d7',
    title: 'Came back on day 7 (day-7 retention)',
    definition: 'Share of users active (logged food or water, or claimed a streak day) on day 7 after entering.',
    numerator: 'Users active on day 7',
    denominator: 'Users who have been in the experiment for at least 8 days',
    maturityLabel: 'Users with 8 days of data',
    group: 'guardrail',
    pending: youngerThan(8 * D),
    label: 'D7 retention',
    kind: 'rate',
    window: 'D7',
    higherIsBetter: true,
    guardrail: { type: 'relative', tolerance: 0.15 },
    evaluate: matureAfter(8 * D, (u) => anyWithin(u.activityAt, u.assignedAt + 7 * D, u.assignedAt + 8 * D)),
  },
  {
    key: 'meal_loggers_d7',
    title: 'Logged a meal in the first 7 days',
    definition: 'Share of users who logged at least one meal within 7 days.',
    numerator: 'Users who logged a meal within 7 days',
    denominator: 'Users who have been in the experiment for at least 7 days',
    maturityLabel: 'Users with 7 days of data',
    group: 'guardrail',
    pending: youngerThan(7 * D),
    label: 'Logged a meal in the first 7 days',
    kind: 'rate',
    window: 'D7',
    higherIsBetter: true,
    guardrail: { type: 'relative', tolerance: 0.15 },
    evaluate: matureAfter(7 * D, (u) => anyWithin(u.mealAt, u.assignedAt - H, u.assignedAt + 7 * D)),
  },
  {
    key: 'trial_cancellation',
    title: 'Cancelled during the free trial',
    definition: 'Of users who started a trial, the share who turned off auto-renew before the trial ended.',
    numerator: 'Trial starters who cancelled during the trial',
    denominator: 'Trial starters whose trial has ended',
    maturityLabel: 'Finished trials',
    group: 'guardrail',
    pending: trialPending(0),
    label: 'Trial cancelled (of trial starters)',
    kind: 'rate',
    window: 'trial',
    higherIsBetter: false,
    guardrail: { type: 'absolute', tolerance: 0.03 },
    evaluate: (u, now) => {
      if (u.trialStartedAt === null || u.trialStartedAt < u.assignedAt - H) return null;
      const end = trialEndOf(u);
      if (now < end) return null;
      return within(u.trialCancelledAt, u.trialStartedAt, end + 1);
    },
  },
  {
    key: 'refunds_d30',
    title: 'Refunded within 30 days',
    definition: 'Share of users who got a refund within 30 days.',
    numerator: 'Users with a refund within 30 days',
    denominator: 'Users who have been in the experiment for at least 30 days',
    maturityLabel: 'Users with 30 days of data',
    group: 'guardrail',
    pending: youngerThan(30 * D),
    label: 'Refunded (D30)',
    kind: 'rate',
    window: 'D30',
    higherIsBetter: false,
    guardrail: { type: 'absolute', tolerance: 0.03 },
    evaluate: matureAfter(30 * D, (u) => within(u.refundAt, u.assignedAt - H, u.assignedAt + 30 * D)),
  },
  {
    key: 'account_deletions_d7',
    title: 'Deleted their account within 7 days',
    definition: 'Share of users who deleted their account within 7 days.',
    numerator: 'Users who deleted their account within 7 days',
    denominator: 'Users who have been in the experiment for at least 7 days',
    maturityLabel: 'Users with 7 days of data',
    group: 'guardrail',
    pending: youngerThan(7 * D),
    label: 'Deleted account (D7)',
    kind: 'rate',
    window: 'D7',
    higherIsBetter: false,
    guardrail: { type: 'absolute', tolerance: 0.03 },
    evaluate: matureAfter(7 * D, (u) => within(u.deletedAt, u.assignedAt - H, u.assignedAt + 7 * D)),
  },
];

export const REVENUE_METRIC: MeanMetricDef = {
  key: 'revenue_per_user_d30',
  title: 'Revenue per user in the first 30 days',
  definition: 'Average USD revenue per user within 30 days (purchases and renewals, minus refunds; sandbox excluded). The ship rule uses this metric.',
  numerator: 'Net USD revenue within 30 days',
  denominator: 'Users who have been in the experiment for at least 30 days',
  maturityLabel: 'Users with 30 days of data',
  group: 'secondary',
  decisionMetric: true,
  pending: youngerThan(30 * D),
  label: 'Revenue per user (D30, USD, net of refunds)',
  kind: 'mean',
  window: 'D30',
  higherIsBetter: true,
  value: (u, now) =>
    now >= u.assignedAt + 30 * D
      ? Math.round(u.revenue.filter((r) => r.at >= u.assignedAt - H && r.at < u.assignedAt + 30 * D).reduce((s, r) => s + r.usd, 0) * 100) / 100
      : null,
};

export interface ArmMetric {
  /** Mature users in the denominator. */
  n: number;
  /** Analysed users who will join the denominator once their window elapses. */
  pending: number;
  /** Successes (rates) — null for means. */
  x: number | null;
  /** Observed rate / mean; null when n = 0. */
  value: number | null;
  ci90: [number, number] | null;
  pBest: number | null;
  pBeatsControl: number | null;
  /** value / control value − 1 (null when either is 0 / unknown). */
  liftVsControl: number | null;
  /** Guardrails only: P(worse than control by more than the tolerance). */
  pGuardrailBreach: number | null;
  /** value − control value (rates: fraction points; means: USD). Null for control / no data. */
  absLift: number | null;
  /** 90 % credible interval of the relative lift (arm / control − 1). Null for control / no data. */
  liftCi90: [number, number] | null;
  /** 90 % credible interval of the absolute difference (arm − control). */
  absLiftCi90: [number, number] | null;
}

export interface MetricResult extends MetricCopy {
  key: string;
  label: string;
  kind: 'rate' | 'mean';
  window: string;
  higherIsBetter: boolean;
  primary: boolean;
  leadingIndicator: boolean;
  decisionMetric: boolean;
  guardrail: { type: 'relative' | 'absolute'; tolerance: number } | null;
  arms: Record<string, ArmMetric>;
}

export interface PopulationResult {
  /** Analysed (randomised + exposed) users per arm. */
  exposed: Record<string, number>;
}

export interface Decision {
  /** Arm that satisfies §2's rule today, else null. */
  candidate: string | null;
  /** Leader on revenue/user D30 and its P(best). */
  leader: string | null;
  leaderPBest: number | null;
  /** Guardrails a non-control arm breaches with P ≥ 0.9 (arm → metric keys). */
  guardrailBreaches: Record<string, string[]>;
  reason: string;
}

export interface ResultsBlock {
  population: PopulationResult;
  metrics: MetricResult[];
  decision: Decision;
}

const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
const finiteOrNull = (v: number) => (Number.isFinite(v) ? r4(v) : null);

function emptyArm(n: number, pending = 0): ArmMetric {
  return { n, pending, x: null, value: null, ci90: null, pBest: null, pBeatsControl: null, liftVsControl: null, pGuardrailBreach: null, absLift: null, liftCi90: null, absLiftCi90: null };
}

const r4pair = (p: [number, number] | null): [number, number] | null => (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [r4(p[0]), r4(p[1])] : null);

function copyOf(def: MetricCopy) {
  return {
    title: def.title,
    definition: def.definition,
    numerator: def.numerator,
    denominator: def.denominator,
    maturityLabel: def.maturityLabel,
    group: def.group,
    leadingIndicator: def.leadingIndicator === true,
    decisionMetric: def.decisionMetric === true,
  };
}

function rateMetric(def: RateMetricDef, users: readonly UserFacts[], arms: readonly string[], control: string, now: number, seed: string): MetricResult {
  const counts: Record<string, { n: number; x: number; pending: number }> = Object.fromEntries(arms.map((a) => [a, { n: 0, x: 0, pending: 0 }]));
  for (const u of users) {
    const c = counts[u.arm];
    if (!c) continue;
    const v = def.evaluate(u, now);
    if (v === null) {
      if (def.pending(u, now)) c.pending++;
      continue;
    }
    c.n++;
    if (v) c.x++;
  }
  const live = arms.filter((a) => counts[a].n > 0);
  const rand = mulberry32(seedFrom(`${seed}|${def.key}`));
  const draws: Record<string, Float64Array> = {};
  for (const a of live) draws[a] = betaDraws(counts[a].x, counts[a].n, RATE_SIMULATIONS, rand);
  const cmp = compareDraws(draws, { higherIsBetter: def.higherIsBetter, reference: draws[control] ? control : undefined });

  const out: Record<string, ArmMetric> = {};
  const controlRate = counts[control]?.n ? counts[control].x / counts[control].n : null;
  for (const a of arms) {
    const { n, x, pending } = counts[a];
    if (!n) {
      out[a] = { ...emptyArm(0, pending), x: 0 };
      continue;
    }
    const value = x / n;
    let pBreach: number | null = null;
    if (def.guardrail && a !== control && draws[control]) {
      const g = def.guardrail;
      let breaches = 0;
      for (let i = 0; i < RATE_SIMULATIONS; i++) {
        const arm = draws[a][i];
        const ctl = draws[control][i];
        const worse =
          g.type === 'relative'
            ? def.higherIsBetter
              ? arm < ctl * (1 - g.tolerance)
              : arm > ctl * (1 + g.tolerance)
            : def.higherIsBetter
              ? arm < ctl - g.tolerance
              : arm > ctl + g.tolerance;
        if (worse) breaches++;
      }
      pBreach = r4(breaches / RATE_SIMULATIONS);
    }
    const lifts = a !== control && draws[control] ? liftIntervals(draws[a], draws[control]) : null;
    out[a] = {
      n,
      pending,
      x,
      value: r4(value),
      ci90: [r4(cmp[a].ci90[0]), r4(cmp[a].ci90[1])],
      pBest: live.length > 1 ? r4(cmp[a].pBest) : null,
      pBeatsControl: cmp[a].pBeatsReference === null ? null : r4(cmp[a].pBeatsReference),
      liftVsControl: a !== control && controlRate ? r4(value / controlRate - 1) : null,
      pGuardrailBreach: pBreach,
      absLift: a !== control && controlRate !== null ? r4(value - controlRate) : null,
      liftCi90: controlRate ? r4pair(lifts?.rel ?? null) : null,
      absLiftCi90: r4pair(lifts?.abs ?? null),
    };
  }
  return {
    ...copyOf(def),
    key: def.key,
    label: def.label,
    kind: 'rate',
    window: def.window,
    higherIsBetter: def.higherIsBetter,
    primary: def.primary === true,
    guardrail: def.guardrail ?? null,
    arms: out,
  };
}

function meanMetric(def: MeanMetricDef, users: readonly UserFacts[], arms: readonly string[], control: string, now: number, seed: string): MetricResult {
  const values: Record<string, number[]> = Object.fromEntries(arms.map((a) => [a, [] as number[]]));
  const pendingBy: Record<string, number> = Object.fromEntries(arms.map((a) => [a, 0]));
  for (const u of users) {
    if (!values[u.arm]) continue;
    const v = def.value(u, now);
    if (v !== null) values[u.arm].push(v);
    else if (def.pending(u, now)) pendingBy[u.arm]++;
  }
  const live = arms.filter((a) => values[a].length > 0);
  const rand = mulberry32(seedFrom(`${seed}|${def.key}`));
  const draws: Record<string, Float64Array> = {};
  for (const a of live) draws[a] = bootstrapMeans(values[a], BOOTSTRAP_RESAMPLES, rand);
  const cmp = compareDraws(draws, { higherIsBetter: def.higherIsBetter, reference: draws[control] ? control : undefined });
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const controlMean = values[control]?.length ? mean(values[control]) : null;

  const out: Record<string, ArmMetric> = {};
  for (const a of arms) {
    const xs = values[a];
    if (!xs.length) {
      out[a] = emptyArm(0, pendingBy[a]);
      continue;
    }
    const value = mean(xs);
    const sorted = Array.from(draws[a]).sort((p, q) => p - q);
    const lifts = a !== control && draws[control] ? liftIntervals(draws[a], draws[control]) : null;
    out[a] = {
      n: xs.length,
      pending: pendingBy[a],
      x: null,
      value: r4(value),
      ci90: [r4(quantileSorted(sorted, 0.05)), r4(quantileSorted(sorted, 0.95))],
      pBest: live.length > 1 ? finiteOrNull(cmp[a].pBest) : null,
      pBeatsControl: cmp[a].pBeatsReference === null ? null : finiteOrNull(cmp[a].pBeatsReference),
      liftVsControl: a !== control && controlMean ? r4(value / controlMean - 1) : null,
      pGuardrailBreach: null,
      absLift: a !== control && controlMean !== null ? r4(value - controlMean) : null,
      liftCi90: controlMean ? r4pair(lifts?.rel ?? null) : null,
      absLiftCi90: r4pair(lifts?.abs ?? null),
    };
  }
  return { ...copyOf(def), key: def.key, label: def.label, kind: 'mean', window: def.window, higherIsBetter: def.higherIsBetter, primary: false, guardrail: null, arms: out };
}

/** §2 decision rule: best D30 revenue/user with P(best) ≥ 90 % and no guardrail breach with P ≥ 90 %. */
export function decide(metrics: readonly MetricResult[], arms: readonly string[], control: string): Decision {
  const revenue = metrics.find((m) => m.key === REVENUE_METRIC.key);
  const breaches: Record<string, string[]> = {};
  for (const m of metrics) {
    if (!m.guardrail) continue;
    for (const a of arms) {
      if (a === control) continue;
      const p = m.arms[a]?.pGuardrailBreach;
      if (p !== null && p !== undefined && p >= DECISION_PROBABILITY) (breaches[a] ??= []).push(m.key);
    }
  }
  let leader: string | null = null;
  let leaderPBest: number | null = null;
  for (const a of arms) {
    const p = revenue?.arms[a]?.pBest ?? null;
    if (p !== null && (leaderPBest === null || p > leaderPBest)) {
      leader = a;
      leaderPBest = p;
    }
  }
  if (!leader || leaderPBest === null) {
    return { candidate: null, leader: null, leaderPBest: null, guardrailBreaches: breaches, reason: 'Not enough mature D30 revenue data yet.' };
  }
  if (leaderPBest < DECISION_PROBABILITY) {
    return { candidate: null, leader, leaderPBest, guardrailBreaches: breaches, reason: `No arm has P(best) ≥ ${DECISION_PROBABILITY * 100}% on revenue/user D30 yet.` };
  }
  if (breaches[leader]?.length) {
    return { candidate: null, leader, leaderPBest, guardrailBreaches: breaches, reason: `${leader} leads on revenue but breaches guardrails: ${breaches[leader].join(', ')}.` };
  }
  return { candidate: leader, leader, leaderPBest, guardrailBreaches: breaches, reason: `${leader} wins revenue/user D30 with P(best) ${(leaderPBest * 100).toFixed(1)}% and no guardrail breach.` };
}

export function computeResults(users: readonly UserFacts[], arms: readonly string[], control: string, now: number, seed: string): ResultsBlock {
  const exposed: Record<string, number> = Object.fromEntries(arms.map((a) => [a, 0]));
  for (const u of users) if (u.arm in exposed) exposed[u.arm]++;
  const metrics = [...RATE_METRICS.map((d) => rateMetric(d, users, arms, control, now, seed)), meanMetric(REVENUE_METRIC, users, arms, control, now, seed)];
  return { population: { exposed }, metrics, decision: decide(metrics, arms, control) };
}

export function segmentValue(u: UserFacts, dim: SegmentDimension): string {
  if (dim === 'country') return u.country ? u.country.toUpperCase() : 'unknown';
  const v = dim === 'platform' ? u.platform : u.channel;
  return v ? v.toLowerCase() : 'unknown';
}

// ---------------------------------------------------------------------------
// Health and time series (Admin Tools scorecard; additive to the §6.6 payload)
// ---------------------------------------------------------------------------

/** GrowthBook's default: flag a sample-ratio mismatch when p < 0.001. */
export const SRM_P_THRESHOLD = 0.001;
/** Chi-square needs ~5 expected users per arm before its p-value means anything. */
export const SRM_MIN_EXPECTED = 5;

export interface SrmCheck {
  /** Configured share per arm (current weights / 100). */
  expectedShare: Record<string, number>;
  /** Analysed (randomised + exposed) users per arm. */
  observed: Record<string, number>;
  /** observed total × expected share. */
  expected: Record<string, number>;
  total: number;
  chiSquare: number | null;
  pValue: number | null;
  threshold: number;
  /** ok = split matches the weights · mismatch = p < threshold · too_few = not enough users to test. */
  status: 'ok' | 'mismatch' | 'too_few';
  /** Weight changes found in the audit log; expected counts use the weights in force when each user was assigned. */
  weightChanges: Array<{ at: string; weights: Record<string, number> }>;
  /** Arms left out of the test because they expect < 5 users so far (e.g. just added). */
  skippedArms: string[];
}

/**
 * Sample-ratio-mismatch test: chi-square goodness of fit of the observed split against the arm weights.
 * `expectedCounts` (from weightsAt per user) overrides the flat `weights` split when weights changed mid-test.
 */
export function srmCheck(
  observed: Record<string, number>,
  weights: Record<string, number>,
  opts: { expectedCounts?: Record<string, number>; weightChanges?: SrmCheck['weightChanges'] } = {}
): SrmCheck {
  const all = Object.keys(weights);
  const total = all.reduce((s, a) => s + (observed[a] ?? 0), 0);
  const totalWeight = all.reduce((s, a) => s + Math.max(0, weights[a]), 0);
  const exp: Record<string, number> = {};
  for (const a of all) exp[a] = opts.expectedCounts ? (opts.expectedCounts[a] ?? 0) : totalWeight ? (total * Math.max(0, weights[a])) / totalWeight : 0;
  const expTotal = all.reduce((s, a) => s + exp[a], 0);
  const expectedShare: Record<string, number> = {};
  const expected: Record<string, number> = {};
  for (const a of all) {
    expectedShare[a] = expTotal ? r4(exp[a] / expTotal) : 0;
    expected[a] = r4(exp[a]);
  }
  const base = { expectedShare, observed: Object.fromEntries(all.map((a) => [a, observed[a] ?? 0])), expected, total, threshold: SRM_P_THRESHOLD, weightChanges: opts.weightChanges ?? [] };
  // (skippedArms is added per outcome below.)
  // Users in an arm that was expected to get nobody is a mismatch by itself.
  if (all.some((a) => exp[a] === 0 && (observed[a] ?? 0) > 0)) return { ...base, chiSquare: null, pValue: 0, status: 'mismatch', skippedArms: [] };
  // Arms expecting too few users (e.g. one added yesterday) are left out; the rest are tested among themselves.
  const arms = all.filter((a) => exp[a] >= SRM_MIN_EXPECTED);
  const skippedArms = all.filter((a) => exp[a] > 0 && exp[a] < SRM_MIN_EXPECTED);
  if (arms.length < 2) return { ...base, chiSquare: null, pValue: null, status: 'too_few', skippedArms };
  const obsSub = arms.reduce((s, a) => s + (observed[a] ?? 0), 0);
  const expSub = arms.reduce((s, a) => s + exp[a], 0);
  let chi = 0;
  for (const a of arms) {
    const e = (exp[a] * obsSub) / expSub;
    chi += ((observed[a] ?? 0) - e) ** 2 / e;
  }
  const p = chiSquarePValue(chi, arms.length - 1);
  return { ...base, chiSquare: r4(chi), pValue: Number.isFinite(p) ? r4(p) : null, status: p < SRM_P_THRESHOLD ? 'mismatch' : 'ok', skippedArms };
}

type ArmWeights = Record<string, number>;
const weightsOf = (arms: unknown): ArmWeights | null =>
  Array.isArray(arms) ? Object.fromEntries(arms.filter((a) => a && typeof a.key === 'string').map((a) => [a.key as string, Number(a.weight) || 0])) : null;
const sameWeights = (a: ArmWeights, b: ArmWeights) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
};

/**
 * Weight history from experiment_audit_log rows ({ at, before, after } with full experiment snapshots).
 * Returns the weights in force from each change on, oldest first; the first entry (from −∞) is the
 * weights before the first change, or `current` when nothing changed.
 */
export function weightHistory(current: ArmWeights, audit: ReadonlyArray<{ at: string; before: unknown; after: unknown }>): Array<{ from: number; weights: ArmWeights }> {
  const changes = audit
    .map((r) => ({ at: Date.parse(r.at), before: weightsOf((r.before as any)?.arms), after: weightsOf((r.after as any)?.arms) }))
    .filter((c) => Number.isFinite(c.at) && c.before && c.after && !sameWeights(c.before, c.after))
    .sort((a, b) => a.at - b.at);
  if (!changes.length) return [{ from: -Infinity, weights: current }];
  return [{ from: -Infinity, weights: changes[0].before! }, ...changes.map((c) => ({ from: c.at, weights: c.after! }))];
}

/** Expected users per arm: each user contributes their assignment-time weights (normalised over `arms`). */
export function expectedCountsAt(history: ReadonlyArray<{ from: number; weights: ArmWeights }>, assignedAt: readonly number[], arms: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(arms.map((a) => [a, 0]));
  for (const t of assignedAt) {
    let w = history[0].weights;
    for (const h of history) if (h.from <= t) w = h.weights;
    const sum = arms.reduce((s, a) => s + Math.max(0, w[a] ?? 0), 0);
    if (!sum) continue;
    for (const a of arms) out[a] += Math.max(0, w[a] ?? 0) / sum;
  }
  return out;
}

export interface DailyEnrollment {
  /** UTC date (YYYY-MM-DD). */
  date: string;
  /** Randomised users assigned that day, per arm. */
  enrolled: Record<string, number>;
  /** Randomised users first exposed that day, per arm. */
  exposed: Record<string, number>;
}

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t: number) => Date.parse(`${utcDay(t)}T00:00:00Z`);
/** Longest daily series returned (most recent days). */
export const TIMELINE_MAX_DAYS = 180;

function dayRange(fromMs: number, toMs: number): number[] {
  const days: number[] = [];
  for (let d = dayStart(fromMs); d <= toMs; d += D) days.push(d);
  return days.slice(-TIMELINE_MAX_DAYS);
}

/** Enrolment and exposure per UTC day per arm, from randomised (reason=bucket) rows. Days with none are 0. */
export function dailyEnrollment(rows: ReadonlyArray<{ arm: string; assignedAt: number; exposedAt: number | null }>, arms: readonly string[], fromMs: number | null, nowMs: number): DailyEnrollment[] {
  const first = rows.reduce((m, r) => Math.min(m, r.assignedAt), fromMs ?? Infinity);
  if (!Number.isFinite(first)) return [];
  const zero = () => Object.fromEntries(arms.map((a) => [a, 0])) as Record<string, number>;
  const out = dayRange(first, nowMs).map((d) => ({ date: utcDay(d), enrolled: zero(), exposed: zero() }));
  const byDate = new Map(out.map((o) => [o.date, o]));
  for (const r of rows) {
    const e = byDate.get(utcDay(r.assignedAt));
    if (e && r.arm in e.enrolled) e.enrolled[r.arm]++;
    if (r.exposedAt !== null) {
      const x = byDate.get(utcDay(r.exposedAt));
      if (x && r.arm in x.exposed) x.exposed[r.arm]++;
    }
  }
  return out;
}

export interface LiftPoint {
  /** n mature, x successes, observed rate. */
  n: number;
  x: number;
  value: number | null;
  /** Relative lift vs control and its 90 % interval (log-ratio normal approximation). Null for control / no data. */
  lift: number | null;
  lo: number | null;
  hi: number | null;
}

export interface MetricTimeline {
  metricKey: string;
  /** Cumulative: what the result looked like at the end of each UTC day. */
  points: Array<{ date: string; arms: Record<string, LiftPoint> }>;
}

const Z90 = 1.6448536269514722;

/** Relative lift arm/control − 1 with a 90 % interval from the delta method on log(p_arm / p_control) (+0.5 smoothing). */
export function approxLift(x: number, n: number, xc: number, nc: number): { lift: number | null; lo: number | null; hi: number | null } {
  if (!n || !nc || xc === 0) return { lift: null, lo: null, hi: null };
  const p = (x + 0.5) / (n + 1);
  const pc = (xc + 0.5) / (nc + 1);
  const se = Math.sqrt((1 - p) / (p * (n + 1)) + (1 - pc) / (pc * (nc + 1)));
  const center = Math.log(p / pc);
  return { lift: r4(x / n / (xc / nc) - 1), lo: r4(Math.exp(center - Z90 * se) - 1), hi: r4(Math.exp(center + Z90 * se) - 1) };
}

/** Cumulative lift per day for the primary and secondary rate metrics (guardrails are read off the scorecard). */
export function liftTimelines(users: readonly UserFacts[], arms: readonly string[], control: string, fromMs: number | null, nowMs: number): MetricTimeline[] {
  const first = users.reduce((m, u) => Math.min(m, u.assignedAt), fromMs ?? Infinity);
  if (!Number.isFinite(first)) return [];
  const days = dayRange(first, nowMs);
  const sorted = [...users].sort((a, b) => a.assignedAt - b.assignedAt);
  return RATE_METRICS.filter((m) => m.group !== 'guardrail').map((def) => ({
    metricKey: def.key,
    points: days.map((d) => {
      const end = Math.min(d + D, nowMs);
      const c: Record<string, { n: number; x: number }> = Object.fromEntries(arms.map((a) => [a, { n: 0, x: 0 }]));
      for (const u of sorted) {
        if (u.assignedAt >= end) break;
        const k = c[u.arm];
        if (!k) continue;
        const v = def.evaluate(u, end);
        if (v === null) continue;
        k.n++;
        if (v) k.x++;
      }
      const ctl = c[control];
      const out: Record<string, LiftPoint> = {};
      for (const a of arms) {
        const { n, x } = c[a];
        const l = a === control || !ctl ? { lift: null, lo: null, hi: null } : approxLift(x, n, ctl.x, ctl.n);
        out[a] = { n, x, value: n ? r4(x / n) : null, ...l };
      }
      return { date: utcDay(d), arms: out };
    }),
  }));
}

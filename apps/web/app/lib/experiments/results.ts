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
import { betaDraws, bootstrapMeans, compareDraws, mulberry32, quantileSorted, seedFrom } from './stats';

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

interface RateMetricDef {
  key: string;
  label: string;
  kind: 'rate';
  window: string;
  higherIsBetter: boolean;
  primary?: boolean;
  guardrail?: { type: 'relative' | 'absolute'; tolerance: number };
  /** null = not in this metric's denominator (yet). */
  evaluate(u: UserFacts, now: number): boolean | null;
}

interface MeanMetricDef {
  key: string;
  label: string;
  kind: 'mean';
  window: string;
  higherIsBetter: boolean;
  value(u: UserFacts, now: number): number | null;
}

const within = (t: number | null, from: number, to: number) => t !== null && t >= from && t < to;
const anyWithin = (ts: readonly number[], from: number, to: number) => ts.some((t) => t >= from && t < to);
/** Mature after `ms` since assignment → evaluate, else null. */
const matureAfter = (ms: number, f: (u: UserFacts) => boolean) => (u: UserFacts, now: number) => (now >= u.assignedAt + ms ? f(u) : null);

export const RATE_METRICS: readonly RateMetricDef[] = [
  {
    key: 'onboarding_completed',
    label: 'Onboarding completed (D3)',
    kind: 'rate',
    window: 'D3',
    higherIsBetter: true,
    evaluate: matureAfter(3 * D, (u) => within(u.onboardingCompletedAt, u.assignedAt - H, u.assignedAt + 3 * D)),
  },
  {
    key: 'paywall_viewed',
    label: 'Paywall viewed (D3)',
    kind: 'rate',
    window: 'D3',
    higherIsBetter: true,
    evaluate: matureAfter(3 * D, (u) => within(u.paywallViewedAt, u.assignedAt - H, u.assignedAt + 3 * D)),
  },
  {
    key: 'trial_started_d1',
    label: 'Trial started (D1)',
    kind: 'rate',
    window: 'D1',
    higherIsBetter: true,
    evaluate: matureAfter(D, (u) => within(u.trialStartedAt, u.assignedAt - H, u.assignedAt + D)),
  },
  {
    key: 'trial_to_paid',
    label: 'Trial → paid (7 days after trial start)',
    kind: 'rate',
    window: 'trial+7d',
    higherIsBetter: true,
    // Denominator: users whose trial started (any time after assignment) at least 7 days ago.
    evaluate: (u, now) => {
      if (u.trialStartedAt === null || u.trialStartedAt < u.assignedAt - H || now < u.trialStartedAt + 7 * D) return null;
      return within(u.trialConvertedAt, u.trialStartedAt, u.trialStartedAt + 7 * D);
    },
  },
  {
    key: 'paid_conversion_d10',
    label: 'Paid conversion (D10)',
    kind: 'rate',
    window: 'D10',
    higherIsBetter: true,
    primary: true,
    evaluate: matureAfter(10 * D, (u) =>
      within(u.trialConvertedAt, u.assignedAt - H, u.assignedAt + 10 * D) || within(u.directPurchaseAt, u.assignedAt - H, u.assignedAt + 10 * D)
    ),
  },
  {
    key: 'retention_d1',
    label: 'D1 retention',
    kind: 'rate',
    window: 'D1',
    higherIsBetter: true,
    guardrail: { type: 'relative', tolerance: 0.15 },
    evaluate: matureAfter(2 * D, (u) => anyWithin(u.activityAt, u.assignedAt + D, u.assignedAt + 2 * D)),
  },
  {
    key: 'retention_d7',
    label: 'D7 retention',
    kind: 'rate',
    window: 'D7',
    higherIsBetter: true,
    guardrail: { type: 'relative', tolerance: 0.15 },
    evaluate: matureAfter(8 * D, (u) => anyWithin(u.activityAt, u.assignedAt + 7 * D, u.assignedAt + 8 * D)),
  },
  {
    key: 'meal_loggers_d7',
    label: 'Logged a meal in the first 7 days',
    kind: 'rate',
    window: 'D7',
    higherIsBetter: true,
    guardrail: { type: 'relative', tolerance: 0.15 },
    evaluate: matureAfter(7 * D, (u) => anyWithin(u.mealAt, u.assignedAt - H, u.assignedAt + 7 * D)),
  },
  {
    key: 'trial_cancellation',
    label: 'Trial cancelled (of trial starters)',
    kind: 'rate',
    window: 'trial',
    higherIsBetter: false,
    guardrail: { type: 'absolute', tolerance: 0.03 },
    evaluate: (u, now) => {
      if (u.trialStartedAt === null || u.trialStartedAt < u.assignedAt - H) return null;
      const end = u.trialEndsAt ?? u.trialStartedAt + 3 * D;
      if (now < end) return null;
      return within(u.trialCancelledAt, u.trialStartedAt, end + 1);
    },
  },
  {
    key: 'refunds_d30',
    label: 'Refunded (D30)',
    kind: 'rate',
    window: 'D30',
    higherIsBetter: false,
    guardrail: { type: 'absolute', tolerance: 0.03 },
    evaluate: matureAfter(30 * D, (u) => within(u.refundAt, u.assignedAt - H, u.assignedAt + 30 * D)),
  },
  {
    key: 'account_deletions_d7',
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
}

export interface MetricResult {
  key: string;
  label: string;
  kind: 'rate' | 'mean';
  window: string;
  higherIsBetter: boolean;
  primary: boolean;
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

function emptyArm(n: number): ArmMetric {
  return { n, x: null, value: null, ci90: null, pBest: null, pBeatsControl: null, liftVsControl: null, pGuardrailBreach: null };
}

function rateMetric(def: RateMetricDef, users: readonly UserFacts[], arms: readonly string[], control: string, now: number, seed: string): MetricResult {
  const counts: Record<string, { n: number; x: number }> = Object.fromEntries(arms.map((a) => [a, { n: 0, x: 0 }]));
  for (const u of users) {
    const c = counts[u.arm];
    if (!c) continue;
    const v = def.evaluate(u, now);
    if (v === null) continue;
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
    const { n, x } = counts[a];
    if (!n) {
      out[a] = { ...emptyArm(0), x: 0 };
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
    out[a] = {
      n,
      x,
      value: r4(value),
      ci90: [r4(cmp[a].ci90[0]), r4(cmp[a].ci90[1])],
      pBest: live.length > 1 ? r4(cmp[a].pBest) : null,
      pBeatsControl: cmp[a].pBeatsReference === null ? null : r4(cmp[a].pBeatsReference),
      liftVsControl: a !== control && controlRate ? r4(value / controlRate - 1) : null,
      pGuardrailBreach: pBreach,
    };
  }
  return {
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
  for (const u of users) {
    const v = values[u.arm] ? def.value(u, now) : null;
    if (v !== null) values[u.arm].push(v);
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
      out[a] = emptyArm(0);
      continue;
    }
    const value = mean(xs);
    const sorted = Array.from(draws[a]).sort((p, q) => p - q);
    out[a] = {
      n: xs.length,
      x: null,
      value: r4(value),
      ci90: [r4(quantileSorted(sorted, 0.05)), r4(quantileSorted(sorted, 0.95))],
      pBest: live.length > 1 ? finiteOrNull(cmp[a].pBest) : null,
      pBeatsControl: cmp[a].pBeatsReference === null ? null : finiteOrNull(cmp[a].pBeatsReference),
      liftVsControl: a !== control && controlMean ? r4(value / controlMean - 1) : null,
      pGuardrailBreach: null,
    };
  }
  return { key: def.key, label: def.label, kind: 'mean', window: def.window, higherIsBetter: def.higherIsBetter, primary: false, guardrail: null, arms: out };
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

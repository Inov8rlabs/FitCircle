import { describe, expect, it } from 'vitest';

import { approxLift, computeResults, dailyEnrollment, decide, expectedCountsAt, liftTimelines, RATE_METRICS, REVENUE_METRIC, segmentValue, srmCheck, weightHistory, type UserFacts } from '../results';
import { betaDraws, bootstrapMeans, chiSquarePValue, compareDraws, liftIntervals, mulberry32, quantileSorted, sampleGamma, seedFrom } from '../stats';

const D = 86_400_000;
const NOW = Date.parse('2026-12-31T00:00:00Z');
const T0 = NOW - 40 * D; // every user fully mature (> 30 days)

let seq = 0;
function user(arm: string, over: Partial<UserFacts> = {}): UserFacts {
  seq++;
  return {
    userId: `u${seq}`,
    arm,
    assignedAt: T0,
    platform: 'ios',
    channel: 'organic',
    country: 'US',
    onboardingCompletedAt: null,
    paywallViewedAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    trialConvertedAt: null,
    directPurchaseAt: null,
    trialCancelledAt: null,
    refundAt: null,
    revenue: [],
    activityAt: [],
    mealAt: [],
    deletedAt: null,
    ...over,
  };
}
const many = (n: number, f: (i: number) => UserFacts) => Array.from({ length: n }, (_, i) => f(i));
const metric = (r: ReturnType<typeof computeResults>, key: string) => r.metrics.find((m) => m.key === key)!;

describe('stats', () => {
  it('seeded PRNG is deterministic', () => {
    const a = mulberry32(seedFrom('x'));
    const b = mulberry32(seedFrom('x'));
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    expect(seedFrom('a')).not.toBe(seedFrom('b'));
  });

  it('gamma and beta samplers have the right means', () => {
    const rand = mulberry32(42);
    let g = 0;
    for (let i = 0; i < 20_000; i++) g += sampleGamma(3, rand);
    expect(g / 20_000).toBeCloseTo(3, 1);
    const draws = betaDraws(30, 100, 20_000, mulberry32(7)); // Beta(31, 71): mean 0.304
    expect(draws.reduce((s, v) => s + v, 0) / draws.length).toBeCloseTo(31 / 102, 2);
    const sorted = Array.from(draws).sort((x, y) => x - y);
    expect(quantileSorted(sorted, 0.05)).toBeGreaterThan(0.22);
    expect(quantileSorted(sorted, 0.95)).toBeLessThan(0.39);
  });

  it('compareDraws: clear winner, symmetric when equal, flips for lower-is-better', () => {
    const r = mulberry32(1);
    const strong = compareDraws({ a: betaDraws(10, 100, 10_000, r), b: betaDraws(40, 100, 10_000, r) }, { higherIsBetter: true, reference: 'a' });
    expect(strong.b.pBest).toBeGreaterThan(0.99);
    expect(strong.b.pBeatsReference).toBeGreaterThan(0.99);
    expect(strong.a.pBeatsReference).toBeNull();
    const flipped = compareDraws({ a: betaDraws(10, 100, 10_000, r), b: betaDraws(40, 100, 10_000, r) }, { higherIsBetter: false });
    expect(flipped.a.pBest).toBeGreaterThan(0.99);
    const even = compareDraws({ a: betaDraws(20, 100, 10_000, r), b: betaDraws(20, 100, 10_000, r) }, { higherIsBetter: true });
    expect(even.a.pBest).toBeGreaterThan(0.4);
    expect(even.a.pBest).toBeLessThan(0.6);
  });

  it('bootstrap means centre on the sample mean', () => {
    const d = bootstrapMeans([0, 0, 0, 10, 20], 4000, mulberry32(3));
    expect(d.reduce((s, v) => s + v, 0) / d.length).toBeCloseTo(6, 0);
    expect(Number.isNaN(bootstrapMeans([], 5, mulberry32(1))[0])).toBe(true);
  });
});

describe('computeResults', () => {
  const arms = ['control', 'variantA', 'variantB'];

  it('is deterministic for the same data and seed', () => {
    const users = [...many(50, () => user('control')), ...many(50, (i) => user('variantA', { trialStartedAt: i < 10 ? T0 + 60_000 : null }))];
    const a = computeResults(users, arms, 'control', NOW, 'seed');
    const b = computeResults(users, arms, 'control', NOW, 'seed');
    expect(a).toEqual(b);
  });

  it('counts per arm and computes rates, lift and P(> control)', () => {
    const users = [
      ...many(100, (i) => user('control', { trialStartedAt: i < 2 ? T0 + 1000 : null })),
      ...many(100, (i) => user('variantA', { trialStartedAt: i < 20 ? T0 + 1000 : null })),
      ...many(100, (i) => user('variantB', { trialStartedAt: i < 10 ? T0 + 1000 : null })),
    ];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(r.population.exposed).toEqual({ control: 100, variantA: 100, variantB: 100 });
    const m = metric(r, 'trial_started_d1');
    expect(m.arms.control).toMatchObject({ n: 100, x: 2, value: 0.02, pBeatsControl: null, liftVsControl: null });
    expect(m.arms.variantA).toMatchObject({ n: 100, x: 20, value: 0.2, liftVsControl: 9 });
    expect(m.arms.variantA.pBeatsControl!).toBeGreaterThan(0.99);
    expect(m.arms.variantA.pBest!).toBeGreaterThan(0.9);
    const sum = arms.reduce((s, a) => s + (m.arms[a].pBest ?? 0), 0);
    expect(sum).toBeCloseTo(1, 3);
    expect(m.arms.variantA.ci90![0]).toBeLessThan(0.2);
    expect(m.arms.variantA.ci90![1]).toBeGreaterThan(0.2);
  });

  it('maturity: users inside the window are left out of n', () => {
    const fresh = NOW - 5 * D;
    const users = [user('control', { assignedAt: fresh }), user('control'), user('variantA', { assignedAt: fresh })];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(metric(r, 'paid_conversion_d14').arms.control.n).toBe(1);
    expect(metric(r, 'paid_conversion_d14').arms.variantA.n).toBe(0);
    expect(metric(r, 'trial_started_d1').arms.control.n).toBe(2);
    // An arm with no mature users has nulls, not a uniform-prior guess.
    expect(metric(r, 'paid_conversion_d14').arms.variantA).toMatchObject({ value: null, pBest: null, ci90: null });
  });

  it('paid conversion D14 = trial converted or direct purchase within 14 days', () => {
    const users = [
      user('control', { trialStartedAt: T0, trialConvertedAt: T0 + 3 * D }),
      user('control', { directPurchaseAt: T0 + 9 * D }),
      user('control', { directPurchaseAt: T0 + 15 * D }),
      user('control'),
    ];
    expect(metric(computeResults(users, arms, 'control', NOW, 's'), 'paid_conversion_d14').arms.control).toMatchObject({ n: 4, x: 2 });
  });

  it('trial → paid uses trial starters only; trial cancellation and retention windows', () => {
    const users = [
      user('control', { trialStartedAt: T0, trialEndsAt: T0 + 3 * D, trialConvertedAt: T0 + 3 * D }),
      user('control', { trialStartedAt: T0, trialEndsAt: T0 + 3 * D, trialCancelledAt: T0 + D }),
      user('control', { activityAt: [T0 + D + 1000, T0 + 7 * D + 1000] }),
      user('control', { activityAt: [T0 + 3 * D] }),
    ];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(metric(r, 'trial_to_paid').arms.control).toMatchObject({ n: 2, x: 1 });
    expect(metric(r, 'trial_cancellation').arms.control).toMatchObject({ n: 2, x: 1 });
    expect(metric(r, 'retention_d1').arms.control).toMatchObject({ n: 4, x: 1 });
    expect(metric(r, 'retention_d7').arms.control).toMatchObject({ n: 4, x: 1 });
  });

  it('trial → paid follows the store trial end (3- and 7-day trials): converted within end + 4 days, matured only after it', () => {
    const now = T0 + 12 * D;
    const users = [
      // 7-day trial converting at the end (day 7)
      user('control', { trialStartedAt: T0, trialEndsAt: T0 + 7 * D, trialConvertedAt: T0 + 7 * D + 3600_000 }),
      // 7-day trial, billing retry converts on day 10 (end + 3 days)
      user('control', { trialStartedAt: T0, trialEndsAt: T0 + 7 * D, trialConvertedAt: T0 + 10 * D }),
      // 7-day trial that has not settled yet (started day 2 → end day 9, settles day 13 > now)
      user('control', { trialStartedAt: T0 + 2 * D, trialEndsAt: T0 + 9 * D }),
      // unknown end → start + the default 7 days; cancelled inside the trial
      user('control', { trialStartedAt: T0, trialEndsAt: null, trialCancelledAt: T0 + 5 * D }),
    ];
    const r = computeResults(users, arms, 'control', now, 's');
    expect(metric(r, 'trial_to_paid').arms.control).toMatchObject({ n: 3, x: 2 });
    expect(metric(r, 'trial_cancellation').arms.control).toMatchObject({ n: 4, x: 1 }); // every trial has ended by day 12
  });

  it('revenue/user D30 nets refunds and ignores revenue after day 30', () => {
    const users = [
      user('control', { revenue: [{ at: T0 + D, usd: 29.99 }, { at: T0 + 5 * D, usd: -29.99 }] }),
      user('control', { revenue: [{ at: T0 + 2 * D, usd: 9.99 }, { at: T0 + 31 * D, usd: 9.99 }] }),
      user('control'),
    ];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(metric(r, REVENUE_METRIC.key).arms.control).toMatchObject({ n: 3, value: 3.33 });
  });

  it('guardrail breach probability: deletions +3 pp absolute', () => {
    const users = [
      ...many(200, () => user('control')),
      ...many(200, (i) => user('variantA', { deletedAt: i < 40 ? T0 + D : null })),
      ...many(200, (i) => user('variantB', { deletedAt: i < 1 ? T0 + D : null })),
    ];
    const m = metric(computeResults(users, arms, 'control', NOW, 's'), 'account_deletions_d7');
    expect(m.arms.variantA.pGuardrailBreach!).toBeGreaterThan(0.99);
    expect(m.arms.variantB.pGuardrailBreach!).toBeLessThan(0.1);
    expect(m.arms.control.pGuardrailBreach).toBeNull();
  });

  it('every §6.6 metric is reported', () => {
    const keys = computeResults([], arms, 'control', NOW, 's').metrics.map((m) => m.key);
    expect(keys).toEqual([...RATE_METRICS.map((m) => m.key), 'revenue_per_user_d30']);
    expect(keys).toEqual(
      expect.arrayContaining([
        'onboarding_completed',
        'paywall_viewed',
        'trial_started_d1',
        'trial_to_paid',
        'paid_conversion_d14',
        'revenue_per_user_d30',
        'retention_d1',
        'retention_d7',
        'meal_loggers_d7',
        'trial_cancellation',
        'refunds_d30',
        'account_deletions_d7',
      ])
    );
  });
});

describe('decision rule (§2)', () => {
  const arms = ['control', 'variantA', 'variantB'];

  it('ships the revenue leader with P(best) ≥ 90 % and no guardrail breach', () => {
    const users = [
      ...many(150, () => user('control', { activityAt: [T0 + D + 1, T0 + 7 * D + 1] })),
      ...many(150, (i) => user('variantA', { revenue: i < 30 ? [{ at: T0 + D, usd: 29.99 }] : [], activityAt: [T0 + D + 1, T0 + 7 * D + 1] })),
      ...many(150, (i) => user('variantB', { revenue: i < 3 ? [{ at: T0 + D, usd: 29.99 }] : [], activityAt: [T0 + D + 1, T0 + 7 * D + 1] })),
    ];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(r.decision.candidate).toBe('variantA');
    expect(r.decision.leaderPBest!).toBeGreaterThan(0.9);
  });

  it('blocks a revenue leader that fails retention (then nothing ships automatically)', () => {
    const users = [
      ...many(150, () => user('control', { activityAt: [T0 + D + 1, T0 + 7 * D + 1] })),
      ...many(150, (i) => user('variantA', { revenue: i < 30 ? [{ at: T0 + D, usd: 29.99 }] : [], activityAt: i < 30 ? [T0 + D + 1] : [] })),
      ...many(150, () => user('variantB', { activityAt: [T0 + D + 1, T0 + 7 * D + 1] })),
    ];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(r.decision.candidate).toBeNull();
    expect(r.decision.leader).toBe('variantA');
    expect(r.decision.guardrailBreaches.variantA).toEqual(expect.arrayContaining(['retention_d1', 'retention_d7']));
  });

  it('no data → no decision', () => {
    expect(decide([], arms, 'control')).toMatchObject({ candidate: null, leader: null });
  });
});

describe('segments', () => {
  it('maps dimension values (unknown when missing)', () => {
    expect(segmentValue(user('control', { platform: 'Android' }), 'platform')).toBe('android');
    expect(segmentValue(user('control', { channel: null }), 'channel')).toBe('unknown');
    expect(segmentValue(user('control', { country: 'ca' }), 'country')).toBe('CA');
  });
});

describe('scorecard additions (lift intervals, copy, health, timelines)', () => {
  const arms = ['control', 'variantA'];

  it('every metric has a title, definition, numerator/denominator, plain n label and group; one primary', () => {
    const r = computeResults([], arms, 'control', NOW, 's');
    for (const m of r.metrics) {
      expect(m.title.length).toBeGreaterThan(5);
      expect(m.definition.length).toBeGreaterThan(10);
      expect(m.numerator && m.denominator && m.maturityLabel).toBeTruthy();
      expect(['primary', 'secondary', 'guardrail']).toContain(m.group);
      expect(m.group === 'guardrail').toBe(m.guardrail !== null);
    }
    expect(r.metrics.filter((m) => m.group === 'primary').map((m) => m.key)).toEqual(['paid_conversion_d14']);
    expect(r.metrics.find((m) => m.leadingIndicator)?.key).toBe('trial_started_d1');
    expect(r.metrics.find((m) => m.decisionMetric)?.key).toBe('revenue_per_user_d30');
  });

  it('lift intervals: relative and absolute, centred on the observed lift, null for control', () => {
    const users = [
      ...many(400, (i) => user('control', { onboardingCompletedAt: i < 100 ? T0 + 1000 : null })),
      ...many(400, (i) => user('variantA', { onboardingCompletedAt: i < 200 ? T0 + 1000 : null })),
    ];
    const m = metric(computeResults(users, arms, 'control', NOW, 's'), 'onboarding_completed');
    const a = m.arms.variantA;
    expect(a.liftVsControl).toBeCloseTo(1, 5);
    expect(a.absLift).toBeCloseTo(0.25, 5);
    expect(a.liftCi90![0]).toBeGreaterThan(0.6);
    expect(a.liftCi90![1]).toBeLessThan(1.5);
    expect(a.liftCi90![0]).toBeLessThan(1);
    expect(a.absLiftCi90![0]).toBeGreaterThan(0.18);
    expect(a.absLiftCi90![1]).toBeLessThan(0.32);
    expect(m.arms.control.liftCi90).toBeNull();
    expect(m.arms.control.absLift).toBeNull();
  });

  it('pending counts users whose window has not elapsed yet', () => {
    const young = NOW - 2 * D;
    const users = [user('control'), user('control', { assignedAt: young }), user('variantA', { assignedAt: young })];
    const r = computeResults(users, arms, 'control', NOW, 's');
    expect(metric(r, 'paid_conversion_d14').arms.control).toMatchObject({ n: 1, pending: 1 });
    expect(metric(r, 'paid_conversion_d14').arms.variantA).toMatchObject({ n: 0, pending: 1 });
    expect(metric(r, 'trial_started_d1').arms.variantA).toMatchObject({ n: 1, pending: 0 });
    expect(metric(r, 'revenue_per_user_d30').arms.variantA).toMatchObject({ n: 0, pending: 1 });
  });

  it('liftIntervals skips undefined ratios', () => {
    const r = liftIntervals(new Float64Array([0.2, 0.3]), new Float64Array([0, 0.1]));
    expect(r.rel![0]).toBeCloseTo(2);
    expect(r.rel![1]).toBeCloseTo(2);
    expect(r.abs![0]).toBeCloseTo(0.2);
  });

  it('chi-square p-values match known table values', () => {
    expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(7.815, 3)).toBeCloseTo(0.05, 3);
    expect(chiSquarePValue(16.266, 3)).toBeCloseTo(0.001, 4);
    expect(chiSquarePValue(0, 2)).toBe(1);
  });

  it('SRM: ok for a fair split, mismatch for a lopsided one, too_few for tiny samples', () => {
    const w = { control: 25, variantA: 25, variantB: 25, variantC: 25 };
    expect(srmCheck({ control: 101, variantA: 98, variantB: 103, variantC: 99 }, w).status).toBe('ok');
    const bad = srmCheck({ control: 200, variantA: 100, variantB: 100, variantC: 100 }, w);
    expect(bad.status).toBe('mismatch');
    expect(bad.pValue!).toBeLessThan(0.001);
    expect(bad.expected.control).toBe(125);
    expect(srmCheck({ control: 3, variantA: 1, variantB: 2, variantC: 2 }, w)).toMatchObject({ status: 'too_few', pValue: null });
    // An arm expecting < 5 users is skipped; the others are still tested.
    const skip = srmCheck({ control: 50, variantA: 50, variantB: 1 }, w, { expectedCounts: { control: 49, variantA: 49, variantB: 3, variantC: 0 } });
    expect(skip).toMatchObject({ status: 'ok', skippedArms: ['variantB'] });
    // Zero-weight arms are left out of the test.
    expect(srmCheck({ control: 50, variantA: 50, variantB: 0 }, { control: 50, variantA: 50, variantB: 0 }).status).toBe('ok');
  });

  it('SRM uses the weights in force when each user was assigned (audit history), not just today’s', () => {
    const arm = (key: string, weight: number) => ({ key, name: key, weight, payload: {} });
    const t1 = '2026-11-12T00:00:00Z';
    const audit = [
      { at: '2026-11-01T00:00:00Z', before: { status: 'draft', arms: [arm('control', 34), arm('variantA', 33), arm('variantB', 33)] }, after: { status: 'running', arms: [arm('control', 34), arm('variantA', 33), arm('variantB', 33)] } },
      { at: t1, before: { arms: [arm('control', 34), arm('variantA', 33), arm('variantB', 33)] }, after: { arms: [arm('control', 25), arm('variantA', 25), arm('variantB', 25), arm('variantC', 25)] } },
    ];
    const current = { control: 25, variantA: 25, variantB: 25, variantC: 25 };
    const h = weightHistory(current, audit);
    expect(h).toHaveLength(2); // status-only change ignored
    expect(h[0].weights).toEqual({ control: 34, variantA: 33, variantB: 33 });
    const arms = Object.keys(current);
    const before = Array.from({ length: 90 }, () => Date.parse('2026-11-05T00:00:00Z'));
    const exp = expectedCountsAt(h, before, arms);
    expect(exp.variantC).toBe(0);
    expect(exp.control).toBeCloseTo(30.6);
    const observed = { control: 31, variantA: 30, variantB: 29, variantC: 0 };
    expect(srmCheck(observed, current).status).toBe('mismatch'); // naive: variantC "should" have 22
    const fair = srmCheck(observed, current, { expectedCounts: exp, weightChanges: [{ at: t1, weights: current }] });
    expect(fair.status).toBe('ok');
    expect(fair.weightChanges).toHaveLength(1);
    // Users in an arm that should have nobody → mismatch.
    expect(srmCheck({ ...observed, variantC: 3 }, current, { expectedCounts: exp }).status).toBe('mismatch');
    expect(weightHistory(current, [])).toEqual([{ from: -Infinity, weights: current }]);
  });

  it('daily enrollment buckets by UTC day and fills gaps with 0', () => {
    const d0 = Date.parse('2026-11-12T10:00:00Z');
    const rows = [
      { arm: 'control', assignedAt: d0, exposedAt: d0 },
      { arm: 'variantA', assignedAt: d0 + 2 * D, exposedAt: null },
    ];
    const out = dailyEnrollment(rows, arms, d0, d0 + 2 * D + 1000);
    expect(out.map((o) => o.date)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14']);
    expect(out[0]).toEqual({ date: '2026-11-12', enrolled: { control: 1, variantA: 0 }, exposed: { control: 1, variantA: 0 } });
    expect(out[1].enrolled).toEqual({ control: 0, variantA: 0 });
    expect(out[2].enrolled.variantA).toBe(1);
    expect(dailyEnrollment([], arms, null, NOW)).toEqual([]);
  });

  it('lift timelines are cumulative and skip guardrails', () => {
    const users = [
      ...many(50, (i) => user('control', { assignedAt: T0 + 6 * 3_600_000, trialStartedAt: i < 10 ? T0 + 7 * 3_600_000 : null })),
      ...many(50, (i) => user('variantA', { assignedAt: T0 + 6 * 3_600_000, trialStartedAt: i < 20 ? T0 + 7 * 3_600_000 : null })),
    ];
    const tl = liftTimelines(users, arms, 'control', T0, T0 + 5 * D);
    expect(tl.map((t) => t.metricKey)).not.toContain('retention_d1');
    const trial = tl.find((t) => t.metricKey === 'trial_started_d1')!;
    expect(trial.points[0].arms.variantA.n).toBe(0); // not mature on day 0
    const last = trial.points.at(-1)!.arms.variantA;
    expect(last).toMatchObject({ n: 50, x: 20, value: 0.4, lift: 1 });
    expect(last.lo!).toBeLessThan(1);
    expect(last.hi!).toBeGreaterThan(1);
    expect(trial.points.at(-1)!.arms.control.lift).toBeNull();
    expect(approxLift(1, 10, 0, 10)).toEqual({ lift: null, lo: null, hi: null });
  });
});

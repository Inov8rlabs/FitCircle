import { describe, expect, it } from 'vitest';

import { computeResults, decide, RATE_METRICS, REVENUE_METRIC, segmentValue, type UserFacts } from '../results';
import { betaDraws, bootstrapMeans, compareDraws, mulberry32, quantileSorted, sampleGamma, seedFrom } from '../stats';

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
    expect(metric(r, 'paid_conversion_d10').arms.control.n).toBe(1);
    expect(metric(r, 'paid_conversion_d10').arms.variantA.n).toBe(0);
    expect(metric(r, 'trial_started_d1').arms.control.n).toBe(2);
    // An arm with no mature users has nulls, not a uniform-prior guess.
    expect(metric(r, 'paid_conversion_d10').arms.variantA).toMatchObject({ value: null, pBest: null, ci90: null });
  });

  it('paid conversion D10 = trial converted or direct purchase within 10 days', () => {
    const users = [
      user('control', { trialStartedAt: T0, trialConvertedAt: T0 + 3 * D }),
      user('control', { directPurchaseAt: T0 + 9 * D }),
      user('control', { directPurchaseAt: T0 + 11 * D }),
      user('control'),
    ];
    expect(metric(computeResults(users, arms, 'control', NOW, 's'), 'paid_conversion_d10').arms.control).toMatchObject({ n: 4, x: 2 });
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
        'paid_conversion_d10',
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

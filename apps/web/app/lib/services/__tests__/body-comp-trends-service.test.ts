import { describe, expect, it } from 'vitest';

import {
  computeBodyCompTrends,
  computeDeltas,
  computeEma,
  computeProjection,
  extractBodyFatGoal,
  interpolateDaily,
  resolveTrendState,
  TRENDS_DISCLAIMER,
  type TrendInput,
  type TrendInputLog,
} from '../body-comp-trends-service';

const day = (n: number) => {
  const d = new Date(Date.UTC(2026, 0, 1 + n)); // 2026-01-01 + n
  return d.toISOString().slice(0, 10);
};

const scan = (n: number, metrics: Partial<TrendInputLog>): TrendInputLog => ({
  measuredAt: `${day(n)}T08:00:00Z`,
  source: 'photo_scan',
  ...metrics,
});

const dailyRange = (count: number, startKg: number, perDay: number) =>
  Array.from({ length: count }, (_, i) => ({ date: day(i), weightKg: startKg + perDay * i }));

describe('computeEma / interpolateDaily', () => {
  it('EMA is seeded with the first value and follows α', () => {
    expect(computeEma([10], 0.25)).toEqual([10]);
    const ema = computeEma([10, 20], 0.25);
    expect(ema[1]).toBeCloseTo(0.25 * 20 + 0.75 * 10);
  });

  it('linearly interpolates missing days between anchors', () => {
    const out = interpolateDaily([
      { date: day(0), value: 90 },
      { date: day(4), value: 94 },
    ]);
    expect(out).toHaveLength(5);
    expect(out[2]).toEqual({ date: day(2), value: 92 });
  });

  it('passes through single points and empty input', () => {
    expect(interpolateDaily([])).toEqual([]);
    expect(interpolateDaily([{ date: day(0), value: 90 }])).toEqual([{ date: day(0), value: 90 }]);
  });
});

describe('computeBodyCompTrends — states', () => {
  it('returns insufficient_data with no data at all', () => {
    const trends = computeBodyCompTrends({ dailyWeights: [], logs: [], goalBodyFatPct: null });
    expect(trends.state).toBe('insufficient_data');
    expect(trends.series).toEqual([]);
    expect(trends.latestVsPrevious).toEqual([]);
    expect(trends.projection).toBeNull();
    expect(trends.insights.map((i) => i.id)).toContain('getting_started');
    expect(trends.disclaimer).toBe(TRENDS_DISCLAIMER);
  });

  it('stays insufficient below 3 scans and 14 weight days', () => {
    const trends = computeBodyCompTrends({
      dailyWeights: dailyRange(10, 90, 0),
      logs: [scan(0, { bodyFatPct: 26 }), scan(5, { bodyFatPct: 25.8 })],
      goalBodyFatPct: null,
    });
    expect(trends.state).toBe('insufficient_data');
  });

  it('detects a losing trend from declining smoothed weight', () => {
    const trends = computeBodyCompTrends({
      dailyWeights: dailyRange(30, 90, -0.1),
      logs: [],
      goalBodyFatPct: null,
    });
    expect(trends.state).toBe('losing');
    expect(trends.series.length).toBe(30);
    expect(trends.series[0].weightKgSmoothed).toBeDefined();
  });

  it('detects a gaining trend from rising smoothed weight', () => {
    const trends = computeBodyCompTrends({
      dailyWeights: dailyRange(30, 90, 0.1),
      logs: [],
      goalBodyFatPct: null,
    });
    expect(trends.state).toBe('gaining');
  });

  it('calls flat weight steady', () => {
    const trends = computeBodyCompTrends({
      dailyWeights: dailyRange(21, 80, 0),
      logs: [],
      goalBodyFatPct: null,
    });
    expect(trends.state).toBe('steady');
  });

  it('detects recomposition: fat mass down beyond noise, SMM steady, weight flat', () => {
    const trends = computeBodyCompTrends({
      dailyWeights: dailyRange(60, 93.5, 0),
      logs: [
        scan(0, { fatMassKg: 25.3, skeletalMuscleMassKg: 39.9, bodyFatPct: 27.1 }),
        scan(30, { fatMassKg: 24.4, skeletalMuscleMassKg: 40.0, bodyFatPct: 26.2 }),
        scan(59, { fatMassKg: 23.6, skeletalMuscleMassKg: 40.1, bodyFatPct: 25.4 }),
      ],
      goalBodyFatPct: null,
    });
    expect(trends.state).toBe('recomposition');
    expect(trends.insights.map((i) => i.id)).toContain('state_recomposition');
    // Scan days carry the scan metrics in the series.
    const scanPoint = trends.series.find((p) => p.date === day(30));
    expect(scanPoint?.fatMassKg).toBe(24.4);
    expect(scanPoint?.skeletalMuscleMassKg).toBe(40.0);
  });
});

describe('resolveTrendState', () => {
  it('does not call recomposition when the scan span is too short', () => {
    const state = resolveTrendState({
      fatTrend: { delta: -2, spanDays: 7 },
      smmTrend: { delta: 0, spanDays: 7 },
      weightChange21: 0,
    });
    expect(state).toBe('steady');
  });

  it('falls back to fat-mass direction when there is no weight series', () => {
    expect(
      resolveTrendState({
        fatTrend: { delta: -2, spanDays: 30 },
        smmTrend: null,
        weightChange21: null,
      })
    ).toBe('losing');
  });
});

describe('computeDeltas — noise floors', () => {
  it('flags scan-to-scan changes under the per-metric floors as withinNoise', () => {
    const deltas = computeDeltas([
      scan(0, { weightKg: 93.5, bodyFatPct: 26.6, fatMassKg: 24.9, skeletalMuscleMassKg: 40.0 }),
      scan(14, { weightKg: 93.2, bodyFatPct: 26.2, fatMassKg: 24.4, skeletalMuscleMassKg: 40.3 }),
    ]);
    const byMetric = Object.fromEntries(deltas.map((d) => [d.metric, d]));
    expect(byMetric.weightKg).toMatchObject({ delta: -0.3, withinNoise: true }); // < 0.5
    expect(byMetric.bodyFatPct).toMatchObject({ delta: -0.4, withinNoise: true }); // < 1.0
    expect(byMetric.fatMassKg).toMatchObject({ delta: -0.5, withinNoise: false }); // ≥ 0.5
    expect(byMetric.skeletalMuscleMassKg).toMatchObject({ delta: 0.3, withinNoise: true }); // < 1.0
  });

  it('uses the two most recent values per metric even across sparse logs', () => {
    const deltas = computeDeltas([
      scan(0, { bodyFatPct: 27.0 }),
      scan(10, { weightKg: 92.0 }), // no BF% on this one
      scan(20, { bodyFatPct: 25.5 }),
    ]);
    const bf = deltas.find((d) => d.metric === 'bodyFatPct');
    expect(bf).toMatchObject({ delta: -1.5, withinNoise: false });
    expect(deltas.find((d) => d.metric === 'weightKg')).toBeUndefined(); // only one weight value
  });
});

describe('computeProjection', () => {
  const base = {
    goalBodyFatPct: 20,
    currentWeightKg: 93.5,
    currentBodyFatPct: 26.6,
    dataSpanDays: 40,
    today: day(40),
  };

  it('returns a clamped 0.5–1% BW/week date RANGE', () => {
    const projection = computeProjection(base);
    expect(projection).not.toBeNull();
    expect(projection!.goalBodyFatPct).toBe(20);
    expect(projection!.earliestDate < projection!.latestDate).toBe(true);
    // loss ≈ 7.71 kg; at 1%BW/wk (0.935) ≈ 8.3 wk, at 0.5%BW/wk ≈ 16.5 wk
    expect(projection!.earliestDate).toBe(day(40 + 58));
    expect(projection!.latestDate).toBe(day(40 + 116));
  });

  it('requires a goal, enough data, and a goal below the current BF%', () => {
    expect(computeProjection({ ...base, goalBodyFatPct: null })).toBeNull();
    expect(computeProjection({ ...base, dataSpanDays: 20 })).toBeNull();
    expect(computeProjection({ ...base, goalBodyFatPct: 27 })).toBeNull();
    expect(computeProjection({ ...base, currentBodyFatPct: null })).toBeNull();
  });

  it('is attached (with its insight) by the full engine when conditions hold', () => {
    const trends = computeBodyCompTrends({
      dailyWeights: dailyRange(40, 93.5, 0),
      logs: [scan(0, { bodyFatPct: 26.8 }), scan(20, { bodyFatPct: 26.7 }), scan(39, { bodyFatPct: 26.6 })],
      goalBodyFatPct: 20,
      today: day(39),
    });
    expect(trends.projection).not.toBeNull();
    expect(trends.projection!.goalBodyFatPct).toBe(20);
    expect(trends.insights.map((i) => i.id)).toContain('projection_band');
  });
});

describe('extractBodyFatGoal', () => {
  it('finds a body_fat_pct goal entry in profiles.goals', () => {
    expect(
      extractBodyFatGoal([
        { type: 'weight', target: 85, unit: 'kg' },
        { type: 'body_fat_pct', target: 20, unit: 'percent' },
      ])
    ).toBe(20);
  });

  it('ignores malformed goals arrays and out-of-range targets', () => {
    expect(extractBodyFatGoal(null)).toBeNull();
    expect(extractBodyFatGoal('goals')).toBeNull();
    expect(extractBodyFatGoal(['stringy-goal'])).toBeNull();
    expect(extractBodyFatGoal([{ type: 'body_fat_pct', target: 300 }])).toBeNull();
    expect(extractBodyFatGoal([{ type: 'body_fat_pct', target: '20' }])).toBeNull();
  });
});

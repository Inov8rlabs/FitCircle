import { describe, expect, it } from 'vitest';

import { KPI_BY_ID } from '../catalog';
import { attainment, buildInsights, decompose, explainMove, fmtValue, zTwoProportions } from '../insights';
import { pmfScore } from '../scorecard';
import type { KpiSegments, PmfKpi } from '../types';

const W = { start: '2026-10-29', end: '2026-11-04' };
const P = { start: '2026-10-22', end: '2026-10-28' };

function kpi(id: string, over: Partial<PmfKpi> & { cur?: [number | null, number, number | null]; prev?: [number | null, number, number | null] } = {}): PmfKpi {
  const def = KPI_BY_ID.get(id)!;
  const [cv, cn, cnum] = over.cur ?? [null, 0, null];
  const [pv, pn, pnum] = over.prev ?? [null, 0, null];
  return {
    id,
    name: def.name,
    group: def.group,
    definition: def.definition,
    unit: def.unit,
    threshold: def.threshold,
    status: 'no_data',
    current: { value: cv, n: cn, numerator: cnum, window: W },
    previous: { value: pv, n: pn, numerator: pnum, window: P },
    change: cv !== null && pv !== null ? Math.round((cv - pv) * 10) / 10 : null,
    trend: [],
    segments: [],
    lowSample: cn > 0 && cn < 30,
    maturityDays: def.maturityDays ?? 0,
    windowLabel: 'Sign-ups Oct 29 – Nov 4',
    notMeasured: def.notMeasured ?? null,
    pmfComponent: null,
    notes: [],
    ...over,
  };
}

const seg = (dimension: 'platform' | 'channel', rows: Array<[string, number, number, number, number]>): KpiSegments => ({
  dimension,
  rows: rows.map(([key, num, n, pnum, pn]) => ({
    key,
    label: key === 'ios' ? 'iOS' : key === 'android' ? 'Android' : key,
    value: n ? Math.round((num / n) * 1000) / 10 : null,
    n,
    numerator: num,
    previous: { value: pn ? Math.round((pnum / pn) * 1000) / 10 : null, n: pn, numerator: pnum },
  })),
});

describe('stats helpers', () => {
  it('two-proportion z', () => {
    expect(zTwoProportions(9, 59, 9, 24)).toBeCloseTo(-2.23, 1);
    expect(zTwoProportions(1, 0, 1, 10)).toBeNull();
    expect(zTwoProportions(0, 10, 0, 10)).toBeNull();
  });
  it('attainment is direction-aware', () => {
    expect(attainment(kpi('d7_retention', { cur: [12.5, 40, 5] }))).toBe(0.5);
    expect(attainment(kpi('cost_per_activated', { cur: [50, 10, 500] }))).toBe(0.5);
  });
  it('formats units', () => {
    expect(fmtValue(0.17, 'hours')).toBe('10 min');
    expect(fmtValue(12.34, 'percent')).toBe('12.3%');
    expect(fmtValue(7.5, 'usd')).toBe('$7.50');
    expect(fmtValue(null, 'usd')).toBe('—');
  });
});

describe('mix decomposition', () => {
  // iOS 45% → 45% and Android 0% → 0%, but iOS share 80% → 30%: a pure mix move.
  const s = seg('platform', [
    ['ios', 9, 20, 9, 20],
    ['android', 0, 46, 0, 5],
  ]);
  it('attributes the move to the mix', () => {
    const d = decompose(s)!;
    expect(d.rate).toBeCloseTo(0);
    expect(d.mix).toBeLessThan(-20);
    expect(d.driver!.label).toBe('iOS');
  });
  it('explains a rate drop as a platform mix shift', () => {
    const k = kpi('activation_first_meal', { cur: [13.6, 66, 9], prev: [36, 25, 9], segments: [s] });
    expect(explainMove(k)).toMatch(/Mostly a platform mix shift: iOS went from 80% to 30%/);
  });
});

describe('buildInsights', () => {
  it('score, gaps, significant movers, segments, coverage — each citing numbers', () => {
    const kpis = [
      kpi('d7_retention', {
        status: 'off_track',
        cur: [10, 100, 10],
        prev: [30, 100, 30],
        segments: [seg('channel', [['apple_ads', 2, 30, 6, 30], ['google_ads', 8, 70, 24, 70]])],
      }),
      kpi('activation_first_meal', {
        status: 'off_track',
        cur: [20, 100, 20],
        prev: [22, 100, 22],
        segments: [seg('platform', [['ios', 15, 30, 0, 0], ['android', 5, 70, 0, 0]])],
      }),
      kpi('cost_per_activated', {
        status: 'off_track',
        cur: [80, 5, 400],
        segments: [{ dimension: 'channel', rows: [{ key: 'apple_ads', label: 'Apple Ads', value: 80, n: 5, numerator: 400, previous: { value: null, n: 0, numerator: null } }] }],
      }),
      kpi('time_to_first_meal', { status: 'on_track', cur: [0.2, 40, null] }),
      kpi('dau', { status: 'off_track', cur: [40, 100, null] }),
      kpi('nps', { status: 'not_measured' }),
    ];
    const ins = buildInsights(kpis, pmfScore(kpis));
    const by = (id: string) => ins.find((i) => i.id === id);
    expect(by('score')!.title).toMatch(/can’t be computed/);
    expect(by('gate-apple_ads')).toMatchObject({ severity: 'critical' });
    expect(by('gate-apple_ads')!.body).toMatch(/\$80\.00 \(5 activated\) ✗ · D7 ≥ 20%: 6\.7% \(2 of 30\) ✗/);
    expect(by('gap-d7_retention')!.title).toMatch(/D7 retention is off track: 10% vs 25% target — 40% of target/);
    const mover = by('mover-d7_retention')!;
    expect(mover.title).toBe('D7 retention fell 20 pts: 30% → 10%');
    expect(mover.severity).toBe('critical');
    expect(mover.body).toMatch(/statistically significant/);
    expect(by('mover-activation_first_meal')).toBeUndefined(); // −2 pts: below the 3-point floor
    expect(by('segment-activation_first_meal-platform')!.title).toMatch(/Android 7\.1% vs iOS 50%/);
    expect(by('gap-scale')!.body).toMatch(/Daily active users/);
    expect(by('wins')!.title).toMatch(/Time to first meal/);
    expect(by('coverage')!.title).toMatch(/Net Promoter Score/);
    expect(by('sample')!.body).toMatch(/Cost per activated user \(paid\) \(n=5\)/);
  });

  it('does not call a move on tiny previous samples', () => {
    const k = kpi('activation_first_meal', { status: 'off_track', cur: [30, 50, 15], prev: [0, 2, 0] });
    expect(buildInsights([k], pmfScore([k])).some((i) => i.kind === 'mover')).toBe(false);
  });
});

describe('signal changes', () => {
  it('a mover on an activity KPI cites a new signal inside the windows and stays informational', () => {
    const k = kpi('dau', { status: 'off_track', cur: [43, 115, null], prev: [15, 55, null], notes: ['Signal change: App-open recording (app_opens) started on 2026-11-09, inside the compared windows, so part of any rise is the new signal, not more usage.'] });
    const m = buildInsights([k], pmfScore([k])).find((i) => i.id === 'mover-dau')!;
    expect(m.severity).toBe('info');
    expect(m.body).toMatch(/started on 2026-11-09/);
  });
});

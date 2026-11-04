/** Pure ad revenue math (lib/ads/ad-revenue.ts). */
import { describe, expect, it } from 'vitest';

import { allocateAdRevenue, arpdauByDay, type AdRevenueRow, dauByDay, groupRevenue, rangeArpdau, revenueDays, sumRevenue, type UserDay } from '../ad-revenue';

const row = (over: Partial<AdRevenueRow>): AdRevenueRow => ({
  source: 'admob',
  date: '2026-11-01',
  app_id: 'app-a',
  app_name: 'FitCircle',
  platform: 'android',
  ad_unit_id: 'unit-a',
  ad_unit_name: 'Home native',
  format: 'NATIVE',
  country: 'US',
  currency: 'USD',
  estimated_earnings: '0.10',
  ad_requests: 10,
  matched_requests: 8,
  impressions: 6,
  clicks: 1,
  ...over,
});

describe('sumRevenue', () => {
  it('derives rates from summed counts', () => {
    const m = sumRevenue([row({}), row({ country: 'CA', estimated_earnings: 0.05, ad_requests: 10, matched_requests: 2, impressions: 2, clicks: 0 })]);
    expect(m.earnings).toBeCloseTo(0.15, 6);
    expect(m.adRequests).toBe(20);
    expect(m.matchRate).toBeCloseTo(10 / 20);
    expect(m.showRate).toBeCloseTo(8 / 10);
    expect(m.ctr).toBeCloseTo(1 / 8);
    expect(m.ecpm).toBeCloseTo((0.15 / 8) * 1000);
  });
  it('null ratios with zero denominators', () => {
    const m = sumRevenue([]);
    expect(m).toMatchObject({ earnings: 0, matchRate: null, showRate: null, ctr: null, ecpm: null, mixedCurrency: false });
  });
});

describe('groupRevenue', () => {
  const rows = [row({}), row({ platform: 'ios', ad_unit_id: 'unit-b', ad_unit_name: null, country: 'ZZ', estimated_earnings: 0.3 })];
  it('groups, labels and shares', () => {
    const p = groupRevenue(rows, 'platform');
    expect(p.map((s) => s.label)).toEqual(['iOS', 'Android']);
    expect(p[0].share).toBeCloseTo(0.75);
    const u = groupRevenue(rows, 'ad_unit');
    expect(u[0]).toMatchObject({ key: 'unit-b', label: 'unit-b' });
    expect(u[1].sublabel).toBe('Android · native · unit-a');
    expect(groupRevenue(rows, 'country').map((s) => s.label)).toEqual(['Unknown country', 'US']);
    expect(groupRevenue(rows, 'format')[0].label).toBe('Native');
  });
  it('slices add up to the total', () => {
    for (const by of ['platform', 'ad_unit', 'country', 'format'] as const) {
      const sum = groupRevenue(rows, by).reduce((s, x) => s + x.metrics.earnings, 0);
      expect(sum).toBeCloseTo(sumRevenue(rows).earnings, 6);
    }
  });
});

describe('DAU, ARPDAU and allocation', () => {
  const days: UserDay[] = [
    { userId: 'u1', date: '2026-11-01', platform: 'android' },
    { userId: 'u1', date: '2026-11-01', platform: 'android' }, // duplicate
    { userId: 'u2', date: '2026-11-01', platform: 'android' },
    { userId: 'u3', date: '2026-11-01', platform: 'ios' },
    { userId: 'u1', date: '2026-11-02', platform: 'android' },
  ];
  const rows = [row({ estimated_earnings: 0.2 }), row({ platform: 'ios', ad_unit_id: 'unit-b', estimated_earnings: 0.06 }), row({ date: '2026-11-02', estimated_earnings: 0.05 })];

  it('distinct users per day and platform', () => {
    const d = dauByDay(days);
    expect(d.get('2026-11-01|android')).toBe(2);
    expect(d.get('2026-11-01|ios')).toBe(1);
    expect(d.get('2026-11-02|android')).toBe(1);
  });

  it('ARPDAU = earnings ÷ user-days', () => {
    const dau = dauByDay(days);
    expect(arpdauByDay(rows, dau).get('2026-11-01|android')).toBeCloseTo(0.1);
    const r = rangeArpdau(rows, dau);
    expect(r.userDays).toBe(4);
    expect(r.arpdau).toBeCloseTo(0.31 / 4);
    expect(r.avgDau).toBe(2);
    expect(rangeArpdau(rows, dau, 'ios').arpdau).toBeCloseTo(0.06);
    expect(rangeArpdau(rows, new Map()).arpdau).toBeNull();
  });

  it('allocation hands out exactly the measured earnings', () => {
    const alloc = allocateAdRevenue(days, arpdauByDay(rows, dauByDay(days)));
    expect(alloc.get('u1')).toBeCloseTo(0.1 + 0.05);
    expect(alloc.get('u2')).toBeCloseTo(0.1);
    expect(alloc.get('u3')).toBeCloseTo(0.06);
    expect([...alloc.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(0.31);
  });

  it('revenueDays fills every day and computes daily ROAS', () => {
    const pts = revenueDays('2026-11-01', '2026-11-03', {
      revenueRows: rows,
      dau: dauByDay(days),
      subscriptionByDay: new Map([['2026-11-02', 7.5]]),
      spendByDay: new Map([
        ['2026-11-01', 10],
        ['2026-11-02', 5],
      ]),
    });
    expect(pts.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(pts[0]).toMatchObject({ adRevenue: 0.26, dau: 3, spend: 10 });
    expect(pts[0].roas).toBeCloseTo(0.026);
    expect(pts[1].roas).toBeCloseTo((0.05 + 7.5) / 5);
    expect(pts[2]).toMatchObject({ adRevenue: 0, dau: null, arpdau: null, roas: null });
  });
});

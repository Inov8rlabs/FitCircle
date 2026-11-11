/** P&L aggregation (lib/finance/pnl.ts) and the gateway sync mapping (ai-cost-sync-service.ts). */
import { describe, expect, it } from 'vitest';

import { buildPnlReport, endOfDayInstant, periodsFor, weekStart, type PnlInput } from '../pnl';
import { recurringAsOf, type PlanMoney } from '../recurring';
import { pullGatewayWindow, reportRows, syncWindow, type GatewayReportClient } from '../services/ai-cost-sync-service';
import type { Plan, RevenueStore } from '../types';

const RANGE = { start: '2026-10-30', end: '2026-11-02', timeZone: 'America/New_York' };

const cashDay = (plan: Plan, store: RevenueStore, m: PlanMoney) => ({ byPlan: new Map([[plan, m]]), byStore: new Map([[store, m]]) });

function input(over: Partial<PnlInput> = {}): PnlInput {
  return {
    range: RANGE,
    grain: 'day',
    now: new Date('2026-11-03T12:00:00Z'),
    subscriptions: new Map(),
    adRevenue: null,
    ua: [],
    ai: [],
    newUsers: new Map(),
    newPayers: new Map(),
    dau: new Map(),
    cash: new Map(),
    recurringAt: (at) => recurringAsOf(new Map(), at),
    ...over,
  };
}

describe('periods', () => {
  it('week = Monday start, month = calendar month, both clipped to the range', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // Sunday → previous Monday
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(periodsFor('2026-10-30', '2026-11-10', 'week')).toEqual([
      { start: '2026-10-30', end: '2026-11-01', label: 'Week of 2026-10-26' },
      { start: '2026-11-02', end: '2026-11-08', label: 'Week of 2026-11-02' },
      { start: '2026-11-09', end: '2026-11-10', label: 'Week of 2026-11-09' },
    ]);
    expect(periodsFor('2026-10-24', '2026-11-10', 'month').map((p) => [p.start, p.end])).toEqual([
      ['2026-10-24', '2026-10-31'],
      ['2026-11-01', '2026-11-10'],
    ]);
  });

  it('end of a New York day is 05:00 UTC next day (EST) / 04:00 (EDT)', () => {
    expect(new Date(endOfDayInstant('2026-11-10', 'America/New_York')).toISOString()).toBe('2026-11-11T05:00:00.000Z');
    expect(new Date(endOfDayInstant('2026-10-24', 'America/New_York')).toISOString()).toBe('2026-10-25T04:00:00.000Z');
  });
});

describe('buildPnlReport', () => {
  it('no data, AdMob not connected: zeros, adRevenue null, margin null', () => {
    const r = buildPnlReport(input());
    expect(r.periods).toHaveLength(4);
    expect(r.totals.revenue).toMatchObject({ subscriptionGross: 0, subscriptionNet: 0, adRevenue: null, totalNet: 0 });
    expect(r.totals.revenue.byPlan.map((p) => p.plan)).toEqual(['monthly', 'annual_upfront', 'annual_installments', 'lifetime', 'other']);
    expect(r.totals).toMatchObject({ net: 0, margin: null, cumulativeNet: 0 });
    expect(r.totals.kpis).toEqual({ newUsers: 0, payers: 0, dauAvg: null, cac: null, aiCostPerDau: null });
    expect(r.notes.join(' ')).toMatch(/AdMob is not connected/);
    expect(r.recurring.mrr).toEqual({ gross: 0, net: 0 });
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it('revenue, refunds, UA by channel, AI classes, KPIs and cumulative net', () => {
    const r = buildPnlReport(
      input({
        grain: 'week',
        subscriptions: new Map([
          ['2026-10-31', { net: 6.99, gross: 9.99, charges: 1 }],
          ['2026-11-02', { net: -6.99, gross: -9.99, charges: 0 }], // refund
        ]),
        cash: new Map([
          ['2026-10-31', cashDay('monthly', 'app_store', { gross: 9.99, net: 6.99, charges: 1 })],
          ['2026-11-02', cashDay('monthly', 'app_store', { gross: -9.99, net: -6.99, charges: 0 })],
        ]),
        adRevenue: new Map([
          ['2026-10-30', 0.2],
          ['2026-11-02', 0.37],
        ]),
        ua: [
          { date: '2026-10-30', channel: 'apple_ads', spend: 30.1 },
          { date: '2026-10-31', channel: 'google_ads', spend: 40.2 },
          { date: '2026-11-02', channel: 'google_ads', spend: 10 },
          { date: '2026-11-05', channel: 'apple_ads', spend: 999 }, // outside range
        ],
        ai: [
          { day: '2026-10-31', production: 0.1, testUsers: 0.01, evalDev: 0.5, unattributed: 0.2 },
          { day: '2026-11-02', production: 0.05, testUsers: 0, evalDev: 0, unattributed: 0.01 },
        ],
        newUsers: new Map([
          ['2026-10-30', 3],
          ['2026-11-02', 2],
        ]),
        newPayers: new Map([['2026-10-31', 1]]),
        dau: new Map([
          ['2026-10-30', 4],
          ['2026-10-31', 6],
          ['2026-11-02', 5],
        ]),
      })
    );
    const [w1, w2] = r.periods;
    expect(w1.revenue).toMatchObject({ subscriptionGross: 9.99, storeFeesAndTax: 3, subscriptionNet: 6.99, adRevenue: 0.2, totalNet: 7.19 });
    expect(w1.revenue.byPlan.find((p) => p.plan === 'monthly')).toEqual({ plan: 'monthly', gross: 9.99, net: 6.99, charges: 1 });
    expect(w1.costs.ua).toEqual({ total: 70.3, byChannel: { apple_ads: 30.1, google_ads: 40.2, meta: 0 } });
    expect(w1.costs.ai).toEqual({ production: 0.1, testUsers: 0.01, evalDev: 0.5, unattributed: 0.2, total: 0.81 });
    expect(w1.costs.total).toBe(71.11);
    expect(w1.net).toBe(-63.92);
    expect(w1.margin).toBeCloseTo(-63.92 / 7.19, 4);
    expect(w1.kpis).toEqual({ newUsers: 3, payers: 1, dauAvg: 5, cac: 23.43, aiCostPerDau: 0.01 });
    expect(w2.revenue).toMatchObject({ subscriptionNet: -6.99, totalNet: -6.62 });
    expect(w2.cumulativeNet).toBe(round4(-63.92 + w2.net));
    expect(r.totals.costs.ua.total).toBe(80.3);
    expect(r.totals.revenue.subscriptionNet).toBe(0);
    expect(r.totals.revenue.byPlan.find((p) => p.plan === 'monthly')!.net).toBe(0);
    expect(r.totals.kpis).toMatchObject({ newUsers: 5, payers: 1, cac: 16.06 });
    expect(r.totals.cumulativeNet).toBe(r.totals.net);
  });

  it('recurring is computed at each period end, capped at now', () => {
    const seen: number[] = [];
    const r = buildPnlReport(input({ grain: 'month', recurringAt: (at) => (seen.push(at), recurringAsOf(new Map(), at)) }));
    expect(r.periods).toHaveLength(2);
    expect(new Date(seen[0]).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // end of Oct 31 (EDT)
    expect(new Date(seen[1]).toISOString()).toBe('2026-11-03T05:00:00.000Z'); // end of Nov 2 (EST)
  });
});

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

describe('gateway sync', () => {
  it('maps report rows per dimension; window defaults to the last 3 UTC days, backfill capped', () => {
    expect(reportRows([{ day: '2026-11-09', totalCost: 0.12, marketCost: 0.11, requestCount: 5 }], 'total')).toEqual([
      { day: '2026-11-09', dimension: 'total', key: '', totalCost: 0.12, marketCost: 0.11, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, requestCount: 5 },
    ]);
    expect(reportRows([{ user: '', totalCost: 1 }], 'user', '2026-11-09')[0]).toMatchObject({ day: '2026-11-09', key: '' });
    expect(syncWindow({}, new Date('2026-11-10T09:15:00Z'))).toEqual({ start: '2026-11-08', end: '2026-11-10' });
    expect(syncWindow({ start: '2026-10-01', end: '2026-10-31' })).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(() => syncWindow({ start: '2026-01-01', end: '2026-11-01' })).toThrow(/120 days/);
  });

  it('daily run pulls 1 + days queries (model only); a backfill pulls 1 + 3 × days', async () => {
    const calls: any[] = [];
    const client: GatewayReportClient = {
      getSpendReport: async (p) => {
        calls.push(p);
        return { results: p.groupBy === 'day' ? [{ day: p.startDate, totalCost: 1 }] : [{ [p.groupBy]: 'k', totalCost: 1 } as any] };
      },
      getCredits: async () => ({ balance: '1', totalUsed: '2' }),
    };
    const daily = await pullGatewayWindow(client, { start: '2026-11-08', end: '2026-11-10' });
    expect(daily.queries).toBe(4);
    expect(calls.map((c) => c.groupBy)).toEqual(['day', 'model', 'model', 'model']);
    calls.length = 0;
    const { rows, queries } = await pullGatewayWindow(client, { start: '2026-11-08', end: '2026-11-10' }, ['user', 'tag', 'model']);
    expect(queries).toBe(10);
    expect(calls).toHaveLength(10);
    expect(rows.filter((r) => r.dimension === 'model').map((r) => r.day)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
  });
});

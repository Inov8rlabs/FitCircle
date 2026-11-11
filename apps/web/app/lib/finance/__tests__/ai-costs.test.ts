/** AI cost report aggregation (lib/finance/ai-costs.ts, pure). */
import { describe, expect, it } from 'vitest';

import { buildAiCostsReport, classifyGatewayKey, gatewayDayClasses, type AiCostsInput } from '../ai-costs';
import type { FinanceUser, GatewayDailyRow, LedgerRow } from '../types';

const REAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAYER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TESTER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVAL = '00000000-0000-0000-0000-0000000000e7';

const user = (userId: string, testReason: string | null = null): FinanceUser => ({ userId, email: `${userId.slice(0, 4)}@x.com`, displayName: null, testReason, createdAt: '2026-10-01T00:00:00Z' });
const USERS = new Map([REAL, PAYER].map((id) => [id, user(id)]));
USERS.set(TESTER, user(TESTER, 'internal'));

const g = (day: string, dimension: GatewayDailyRow['dimension'], key: string, totalCost: number, requestCount = 1): GatewayDailyRow => ({
  day,
  dimension,
  key,
  totalCost,
  marketCost: totalCost * 0.9,
  inputTokens: 100 * requestCount,
  outputTokens: 10 * requestCount,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  requestCount,
});

function input(over: Partial<AiCostsInput> = {}): AiCostsInput {
  return {
    range: { start: '2026-11-01', end: '2026-11-02', timeZone: 'America/New_York' },
    includeTest: false,
    now: new Date('2026-11-03T00:00:00Z'),
    gatewayRows: [],
    ledger: [],
    users: USERS,
    activity: [],
    segments: new Map(),
    revenueByUser: new Map(),
    lastSyncAt: null,
    creditsBalance: null,
    ledgerSince: null,
    ...over,
  };
}

describe('key classification', () => {
  it('untagged, eval, system, test, real, unknown uuid, named probe', () => {
    expect(classifyGatewayKey('', USERS)).toBe('unattributed');
    expect(classifyGatewayKey(EVAL, USERS)).toBe('evalDev');
    expect(classifyGatewayKey('zdr-probe', USERS)).toBe('evalDev');
    expect(classifyGatewayKey('system:embed-foods', USERS)).toBe('system');
    expect(classifyGatewayKey(TESTER, USERS)).toBe('testUsers');
    expect(classifyGatewayKey(REAL, USERS)).toBe('production');
    expect(classifyGatewayKey(GONE, USERS)).toBe('production'); // deleted account: still a real paid request
  });

  it('dev-tagged spend comes out of system work; uncovered total is unattributed', () => {
    const rows = [g('2026-11-01', 'total', '', 1.0), g('2026-11-01', 'user', 'system:cost-probe', 0.1), g('2026-11-01', 'user', REAL, 0.5), g('2026-11-01', 'tag', 'env:development', 0.1)];
    expect(gatewayDayClasses(rows, USERS)).toEqual({ production: 0.5, testUsers: 0, evalDev: 0.1, unattributed: expect.closeTo(0.4, 9) });
  });
});

describe('buildAiCostsReport', () => {
  it('no data at all: zeros, nulls, notes, never NaN', () => {
    const r = buildAiCostsReport(input());
    expect(r.totals).toEqual({ gatewayTotal: 0, fitcircleProduction: 0, testUsers: 0, evalDev: 0, unattributed: 0, requests: 0, inputTokens: 0, outputTokens: 0 });
    expect(r.byDay).toHaveLength(2);
    expect(r.byDay[0]).toMatchObject({ dau: 0, costPerDau: null, ledger: null, diff: null, source: 'gateway' });
    expect(r.perUser).toMatchObject({ activeUsers: 0, userDays: 0, aiUsers: 0, costPerDauDay: null, costPerAiUser: null });
    expect(r.perUser.segments.map((s) => s.segment)).toEqual(['paying', 'trial', 'free']);
    expect(r.notes.join(' ')).toMatch(/no synced gateway data/);
    expect(r.notes.join(' ')).toMatch(/No per-call ledger/);
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it('untagged history: classes from the gateway user dimension; eval + test users split out; per-DAU math', () => {
    const rows = [
      g('2026-11-01', 'total', '', 2.0, 10),
      g('2026-11-01', 'user', '', 1.0, 6),
      g('2026-11-01', 'user', REAL, 0.3, 2),
      g('2026-11-01', 'user', TESTER, 0.2, 1),
      g('2026-11-01', 'user', EVAL, 0.5, 1),
      g('2026-11-01', 'tag', '', 1.0, 6),
      g('2026-11-01', 'tag', 'nutrition', 1.0, 4),
      g('2026-11-01', 'tag', 'source:photo', 0.7, 3),
      g('2026-11-01', 'tag', 'source:text', 0.3, 1),
      g('2026-11-01', 'model', 'google/gemini-3.8-flash', 2.0, 10),
    ];
    const activity = [
      { userId: REAL, at: '2026-11-01T10:00:00Z', platform: 'ios' },
      { userId: REAL, at: '2026-11-01T23:30:00Z', platform: 'ios' }, // same UTC day
      { userId: PAYER, at: '2026-11-01T03:00:00Z', platform: 'android' }, // Oct 31 in New York, Nov 1 UTC
      { userId: TESTER, at: '2026-11-01T12:00:00Z', platform: 'ios' },
    ];
    const r = buildAiCostsReport(input({ gatewayRows: rows, activity, segments: new Map([[PAYER, 'paying' as const]]), revenueByUser: new Map([[PAYER, { monthly: 6.99 }]]) }));
    expect(r.totals).toMatchObject({ gatewayTotal: 2, fitcircleProduction: 0.3, testUsers: 0.2, evalDev: 0.5, unattributed: 1, requests: 10 });
    expect(r.byDay[0]).toMatchObject({ dau: 2, costPerDau: 0.15, source: 'gateway' });
    expect(r.perUser).toMatchObject({ activeUsers: 2, userDays: 2, aiUsers: 1, costPerDauDay: 0.15, costPerAiUser: 0.3 });
    const paying = r.perUser.segments.find((s) => s.segment === 'paying')!;
    expect(paying).toMatchObject({ users: 1, aiUsers: 0, userDays: 1, cost: 0, revenueNet: 6.99, costToRevenue: 0 });
    expect(paying.revenueNetByPlan).toMatchObject({ monthly: 6.99, annual_upfront: 0 });
    const free = r.perUser.segments.find((s) => s.segment === 'free')!;
    expect(free).toMatchObject({ users: 1, aiUsers: 1, cost: 0.3, costPerUser: 0.3, revenueNet: 0, costToRevenue: null });
    // Features: legacy source tags + untagged, summing to the day total.
    expect(r.byFeature.map((f) => [f.feature, f.cost])).toEqual([
      ['untagged', 1],
      ['food_photo', 0.7],
      ['food_text', 0.3],
    ]);
    expect(r.byModel[0]).toMatchObject({ model: 'google/gemini-3.8-flash', cost: 2, requests: 10 });
    // Users table: eval ids never listed; test user flagged.
    expect(r.users.map((u) => [u.userId, u.isTest])).toEqual([
      [REAL, false],
      [TESTER, true],
    ]);
    expect(r.users[0]).toMatchObject({ platform: 'ios', activeDays: 1, topFeature: null, firstAt: '2026-11-01', lastAt: '2026-11-01' });
  });

  it('includeTest counts test users in DAU and per-DAU cost', () => {
    const rows = [g('2026-11-01', 'total', '', 0.5), g('2026-11-01', 'user', REAL, 0.3), g('2026-11-01', 'user', TESTER, 0.2)];
    const activity = [
      { userId: REAL, at: '2026-11-01T10:00:00Z', platform: 'ios' },
      { userId: TESTER, at: '2026-11-01T12:00:00Z', platform: 'ios' },
    ];
    const r = buildAiCostsReport(input({ gatewayRows: rows, activity, includeTest: true }));
    expect(r.byDay[0]).toMatchObject({ dau: 2, costPerDau: 0.25 });
    expect(r.perUser.aiUsers).toBe(2);
  });

  it('ledger days: classes from the ledger, gateway excess is unattributed, reconciliation flags > 2 %', () => {
    const rows = [g('2026-11-01', 'total', '', 1.0), g('2026-11-01', 'tag', 'feature:fitzy_chat', 0.6, 3), g('2026-11-01', 'tag', 'feature:food_photo', 0.3, 1), g('2026-11-01', 'tag', 'nutrition', 0.3, 1), g('2026-11-02', 'total', '', 0.2)];
    const L = (createdAt: string, userId: string | null, feature: string, costUsd: number | null, environment = 'production'): LedgerRow => ({ createdAt, userId, feature, model: 'm', environment, costUsd, ok: true });
    const ledger = [
      L('2026-11-01T01:00:00Z', REAL, 'fitzy_chat', 0.5),
      L('2026-11-01T02:00:00Z', REAL, 'food_photo', 0.2),
      L('2026-11-01T03:00:00Z', TESTER, 'fitzy_chat', 0.1),
      L('2026-11-01T04:00:00Z', null, 'eval', 0.05, 'development'),
      L('2026-11-01T05:00:00Z', REAL, 'food_item', null), // no cost from the gateway
      L('2026-11-02T05:00:00Z', REAL, 'fitzy_chat', 0.2),
    ];
    const r = buildAiCostsReport(input({ gatewayRows: rows, ledger, ledgerSince: '2026-11-01' }));
    expect(r.byDay[0]).toMatchObject({ source: 'ledger', production: 0.7, testUsers: 0.1, evalDev: 0.05, unattributed: 0.15, ledger: 0.85, diff: -0.15, diffPct: -15, flagged: true });
    expect(r.byDay[1]).toMatchObject({ ledger: 0.2, diff: 0, diffPct: 0, flagged: false, unattributed: 0 });
    // Ledger days: features come from the ledger (tags ignored); billed spend above it is "untracked".
    expect(r.byFeature.find((f) => f.feature === 'fitzy_chat')).toMatchObject({ users: 2 });
    expect(r.byFeature.find((f) => f.feature === 'fitzy_chat')!.cost).toBeCloseTo(0.8, 9); // 0.5 + 0.1 (day 1) + 0.2 (day 2)
    expect(r.byFeature.find((f) => f.feature === 'food_photo')).toMatchObject({ cost: 0.2, users: 1 });
    expect(r.byFeature.find((f) => f.feature === 'untracked')!.cost).toBeCloseTo(0.15, 9);
    expect(r.byFeature.find((f) => f.feature === 'other_tagged')).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/differs by more than 2%/);
  });

  it('ledger above gateway (partial day not yet synced) stays visible, unattributed never negative', () => {
    const ledger: LedgerRow[] = [{ createdAt: '2026-11-02T10:00:00Z', userId: REAL, feature: 'fitzy_chat', model: 'm', environment: 'production', costUsd: 0.4, ok: true }];
    const r = buildAiCostsReport(input({ ledger, ledgerSince: '2026-11-02' }));
    expect(r.byDay[1]).toMatchObject({ gatewayTotal: 0, production: 0.4, unattributed: 0, diff: 0.4, diffPct: 100, flagged: true });
  });

  it('tagging roll-out day: legacy source:<x> spend not covered by feature:food_<x> still counts as that feature', () => {
    const rows = [
      g('2026-11-01', 'total', '', 1.0, 10),
      g('2026-11-01', 'tag', '', 0.2, 4),
      g('2026-11-01', 'tag', 'source:photo', 0.5, 3), // 2 calls before tagging + 1 after
      g('2026-11-01', 'tag', 'feature:food_photo', 0.3, 1),
      g('2026-11-01', 'tag', 'feature:fitzy_chat', 0.3, 2),
    ];
    const r = buildAiCostsReport(input({ gatewayRows: rows }));
    expect(r.byFeature.map((f) => [f.feature, f.cost, f.requests])).toEqual([
      ['food_photo', 0.5, 3],
      ['fitzy_chat', 0.3, 2],
      ['untagged', 0.2, 4],
    ]);
  });

  it('zero DAU with spend: costPerDau null, not Infinity', () => {
    const r = buildAiCostsReport(input({ gatewayRows: [g('2026-11-01', 'total', '', 0.3), g('2026-11-01', 'user', REAL, 0.3)] }));
    expect(r.byDay[0].costPerDau).toBeNull();
    expect(r.perUser.costPerDauDay).toBeNull();
    expect(r.perUser.costPerAiUser).toBe(0.3);
  });
});

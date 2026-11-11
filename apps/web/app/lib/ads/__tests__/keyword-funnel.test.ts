import { describe, expect, it } from 'vitest';

import { buildKeywordFunnel, funnelMetrics, MIN_SIGNUPS_TO_JUDGE } from '../keyword-funnel';
import type { CohortUser, RevenueEvent } from '../metrics';
import { buildRows, buildTotals } from '../report';
import type { AdEntityRow, AdMetricRow, AttributionRow } from '../types';

const ent = (over: Partial<AdEntityRow>): AdEntityRow => ({
  channel: 'apple_ads',
  platform: 'ios',
  level: 'campaign',
  external_id: 'C1',
  parent_external_id: null,
  campaign_external_id: 'C1',
  name: 'US Search',
  status: 'ENABLED',
  serving_status: 'RUNNING',
  bid_strategy: 'MANUAL_CPT',
  bid_amount: null,
  bid_currency: 'USD',
  daily_budget: 50,
  total_budget: null,
  match_type: null,
  countries: ['US'],
  start_at: null,
  end_at: null,
  creative: null,
  synced_at: '2026-10-24T12:00:00Z',
  ...over,
});

const ENTITIES: AdEntityRow[] = [
  ent({}),
  ent({ level: 'ad_group', external_id: 'G1', parent_external_id: 'C1', name: 'Snap a meal' }),
  ent({ level: 'keyword', external_id: 'K1', parent_external_id: 'G1', name: 'calorie counter', bid_amount: 2, match_type: 'EXACT' }),
  ent({ level: 'keyword', external_id: 'K2', parent_external_id: 'G1', name: 'macro tracker', bid_amount: 1.5, match_type: 'BROAD' }),
  ent({ level: 'keyword', external_id: 'K3', parent_external_id: 'G1', name: 'paused kw', status: 'PAUSED', serving_status: null }),
  ent({ channel: 'google_ads', platform: 'android', external_id: 'GC1', campaign_external_id: 'GC1', name: 'Android installs' }),
  ent({ channel: 'google_ads', platform: 'android', level: 'ad_group', external_id: 'GG1', parent_external_id: 'GC1', campaign_external_id: 'GC1', name: 'AG 1' }),
];

const m = (level: AdMetricRow['level'], id: string, spend: number, taps: number, installs: number, channel: AdMetricRow['channel'] = 'apple_ads', camp = 'C1'): AdMetricRow => ({
  channel,
  level,
  external_id: id,
  campaign_external_id: camp,
  date: '2026-10-24',
  spend,
  currency: 'USD',
  impressions: taps * 10,
  taps,
  installs,
});

// Campaign 30 = K1 15 + K2 5 + 10 Search Match (no keyword row).
const METRICS = [
  m('campaign', 'C1', 30, 20, 8),
  m('ad_group', 'G1', 30, 20, 8),
  m('keyword', 'K1', 15, 10, 4),
  m('keyword', 'K2', 5, 3, 1),
  m('campaign', 'GC1', 40, 50, 10, 'google_ads', 'GC1'),
  m('ad_group', 'GG1', 40, 50, 10, 'google_ads', 'GC1'),
];

const attr = (over: Partial<AttributionRow>): AttributionRow => ({
  user_id: 'x',
  channel: 'apple_ads',
  platform: 'ios',
  source: 'apple_search_ads',
  campaign_external_id: 'C1',
  ad_group_external_id: 'G1',
  keyword_external_id: 'K1',
  ad_external_id: null,
  click_at: null,
  country: 'US',
  is_test: false,
  raw: null,
  ...over,
});

const trial = (id: string): RevenueEvent => ({ id: `t-${id}`, user_id: id, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: '2026-10-24T16:00:00Z', raw: { price: 0, period_type: 'TRIAL' } });
const paid = (id: string): RevenueEvent => ({ id: `p-${id}`, user_id: id, type: 'RENEWAL', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: '2026-10-27T16:00:00Z', raw: { price: 10, takehome_percentage: 0.85, transaction_id: `tx-${id}` } });

const u = (id: string, a: AttributionRow | null, events: RevenueEvent[] = []): CohortUser => ({
  userId: id,
  signupAt: '2026-10-24T15:00:00Z',
  signupDate: '2026-10-24',
  attribution: a ? { ...a, user_id: id } : null,
  firstActivityAt: null,
  events,
});

const COHORT: CohortUser[] = [
  u('a', attr({}), [trial('a'), paid('a')]),
  u('b', attr({}), [trial('b')]),
  u('c', attr({ keyword_external_id: 'K2' })),
  u('d', attr({ keyword_external_id: null })), // Search Match / no consent
  u('e', attr({ keyword_external_id: null }), [trial('e')]),
  u('o', attr({ channel: 'organic', campaign_external_id: null, ad_group_external_id: null, keyword_external_id: null })),
  u('t', attr({ campaign_external_id: '1234567890', is_test: true })), // Apple mock payload → not Apple
  u('g1', attr({ channel: 'google_ads', platform: 'android', campaign_external_id: 'GC1', ad_group_external_id: 'GG1', keyword_external_id: null }), [trial('g1')]),
  u('g2', attr({ channel: 'google_ads', platform: 'android', campaign_external_id: 'GC1', ad_group_external_id: null, keyword_external_id: null })),
];
const PAYWALL = new Set(['a', 'b', 'd', 'g1', 'o']);

const base = { metricRows: METRICS, entities: ENTITIES, cohort: COHORT, rangeEnd: '2026-10-24', today: '2026-11-11', paywallUsers: PAYWALL };

describe('buildKeywordFunnel (Apple, keyword)', () => {
  const f = buildKeywordFunnel({ ...base, channel: 'apple_ads', level: 'keyword' });
  const by = Object.fromEntries(f.rows.map((r) => [r.key, r]));

  it('funnel per keyword: spend → taps → installs → sign-ups → paywall → trials → payers → revenue', () => {
    expect(by['apple_ads:keyword:K1']).toMatchObject({ label: 'calorie counter', sublabel: 'US Search › Snap a meal', matchType: 'EXACT', bidAmount: 2, adGroupExternalId: 'G1', status: 'RUNNING', unattributed: false });
    expect(by['apple_ads:keyword:K1'].metrics).toMatchObject({ spend: 15, taps: 10, installs: 4, signUps: 2, paywall: 2, trials: 2, payers: 1, revenue: 8.5, costPerSignUp: 7.5, costPerTrial: 7.5, costPerPayer: 15, signUpToTrial: 1, lowSample: true, flag: null });
    expect(by['apple_ads:keyword:K2'].metrics).toMatchObject({ spend: 5, signUps: 1, paywall: 0, trials: 0, payers: 0, revenue: 0, costPerTrial: null, costPerPayer: null, flag: 'no_trials' });
  });

  it('keywords with no delivery and no users still show, with no flag and — ratios', () => {
    expect(by['apple_ads:keyword:K3'].metrics).toMatchObject({ spend: 0, signUps: 0, costPerSignUp: null, flag: null, lowSample: true });
    expect(by['apple_ads:keyword:K3'].status).toBe('PAUSED');
  });

  it('an explicit unattributed row (last) carries Search Match spend and users without a keyword id', () => {
    const none = f.rows[f.rows.length - 1];
    expect(none).toMatchObject({ key: 'apple_ads:none', unattributed: true, label: 'Unattributed (no keyword)', level: null });
    expect(none.metrics).toMatchObject({ spend: 10, taps: 7, installs: 3, signUps: 2, paywall: 1, trials: 1 });
  });

  it('only this channel: organic, test-payload and Google users never appear', () => {
    expect(f.rows.every((r) => r.key.startsWith('apple_ads:'))).toBe(true);
    expect(f.totals.metrics.signUps).toBe(5);
  });

  it('rows reconcile with the campaign-level total, which equals the overview (by campaign) for Apple', () => {
    expect(f.reconciliation.every((r) => r.ok)).toBe(true);
    const camp = buildRows('campaign', { ...base }).find((r) => r.key === 'apple_ads:campaign:C1')!.metrics;
    expect(f.totals.metrics).toMatchObject({ spend: camp.spend, taps: camp.taps, installs: camp.installs, signUps: camp.users, trials: camp.trials, payers: camp.payers, revenue: camp.revenueToDate });
    expect(buildTotals({ ...base, filter: { channel: 'apple_ads' } }).metrics.users).toBe(5);
    expect(f.totals.metrics).toMatchObject({ paywall: 3, costPerSignUp: 6, costPerTrial: 10, costPerPayer: 30 });
  });

  it('sorted by spend, unattributed last', () => {
    expect(f.rows.map((r) => r.key)).toEqual(['apple_ads:keyword:K1', 'apple_ads:keyword:K2', 'apple_ads:keyword:K3', 'apple_ads:none']);
  });
});

describe('buildKeywordFunnel (ad groups, Google)', () => {
  it('Apple by ad group: all keyword spend + Search Match lands on the ad group', () => {
    const f = buildKeywordFunnel({ ...base, channel: 'apple_ads', level: 'ad_group' });
    expect(f.rows.find((r) => r.key === 'apple_ads:ad_group:G1')!.metrics).toMatchObject({ spend: 30, signUps: 5, trials: 3, paywall: 3 });
    expect(f.rows.find((r) => r.unattributed)).toBeUndefined();
    expect(f.reconciliation.every((r) => r.ok)).toBe(true);
  });

  it('Google by ad group: users without an ad group id go to the unattributed row', () => {
    const f = buildKeywordFunnel({ ...base, channel: 'google_ads', level: 'ad_group' });
    expect(f.rows.find((r) => r.key === 'google_ads:ad_group:GG1')!.metrics).toMatchObject({ spend: 40, signUps: 1, paywall: 1, trials: 1 });
    expect(f.rows.find((r) => r.unattributed)!.metrics).toMatchObject({ spend: 0, signUps: 1, trials: 0, flag: 'no_trials' });
    expect(f.reconciliation.every((r) => r.ok)).toBe(true);
    expect(f.totals.metrics.spend).toBe(40);
  });
});

describe('funnelMetrics flags', () => {
  const empty = buildTotals({ metricRows: [], entities: [], cohort: [], rangeEnd: '2026-10-24', today: '2026-10-24' }).metrics;
  const metrics = (over: Partial<typeof empty>) => ({ ...empty, ...over });
  it('spend without sign-ups → no_signups; sign-ups without trials → no_trials; low sample under the threshold', () => {
    expect(funnelMetrics(metrics({ spend: 12, users: 0 }), 0).flag).toBe('no_signups');
    expect(funnelMetrics(metrics({ spend: 12, users: 12, trials: 0 }), 4)).toMatchObject({ flag: 'no_trials', lowSample: false, signUpToPaywall: 4 / 12 });
    expect(funnelMetrics(metrics({ spend: 12, users: MIN_SIGNUPS_TO_JUDGE - 1, trials: 1 }), 0)).toMatchObject({ flag: null, lowSample: true });
    expect(funnelMetrics(metrics({ spend: 0, users: 0 }), 0).flag).toBeNull();
  });
});

describe('honesty: unknown ids, rounding residue, explained gaps', () => {
  it('attribution ids that match no synced ad group are kept as rows, marked unknownEntity and counted', () => {
    const cohort = [...COHORT, u('g3', attr({ channel: 'google_ads', platform: 'android', campaign_external_id: 'GC1', ad_group_external_id: 'GX9', keyword_external_id: null }))];
    const f = buildKeywordFunnel({ ...base, cohort, channel: 'google_ads', level: 'ad_group' });
    expect(f.rows.find((r) => r.key === 'google_ads:ad_group:GX9')).toMatchObject({ unknownEntity: true, label: '#GX9' });
    // No spend of its own: cost per sign-up is unknown, not $0.
    expect(f.rows.find((r) => r.key === 'google_ads:ad_group:GX9')!.metrics).toMatchObject({ signUps: 1, costPerSignUp: null, costPerTrial: null });
    expect(f.rows.find((r) => r.key === 'google_ads:ad_group:GG1')!.unknownEntity).toBe(false);
    expect(f.unknownEntitySignUps).toBe(1);
  });

  it('cents of campaign-vs-child rounding residue are not flagged as "spend, no sign-ups"', () => {
    const metricRows = [m('campaign', 'C1', 30.03, 20, 8), m('ad_group', 'G1', 30, 20, 8)];
    const f = buildKeywordFunnel({ ...base, metricRows, channel: 'apple_ads', level: 'ad_group' });
    const none = f.rows.find((r) => r.unattributed)!;
    expect(none.metrics.spend).toBe(0.03);
    expect(none.metrics.flag).toBeNull();
    expect(f.reconciliation.every((r) => r.ok)).toBe(true);
  });

  it('Google ad-group installs (conversions) vs campaign app installs: mismatch reported with its reason', () => {
    const metricRows = [m('campaign', 'GC1', 40, 50, 10, 'google_ads', 'GC1'), m('ad_group', 'GG1', 40, 50, 13, 'google_ads', 'GC1')];
    const f = buildKeywordFunnel({ ...base, metricRows, channel: 'google_ads', level: 'ad_group' });
    const inst = f.reconciliation.find((r) => r.field === 'installs')!;
    expect(inst).toMatchObject({ rows: 13, campaign: 10, ok: false });
    expect(inst.note).toMatch(/conversions/);
    expect(f.reconciliation.filter((r) => r.field !== 'installs').every((r) => r.ok && r.note === null)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';

import type { CohortUser } from '../metrics';
import { buildRows, buildTimeseries, buildTotals, type SliceInput } from '../report';
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
  ent({ level: 'keyword', external_id: 'K1', parent_external_id: 'G1', name: 'calorie counter', bid_amount: 2 }),
  ent({ level: 'keyword', external_id: 'K2', parent_external_id: 'G1', name: 'macro tracker', bid_amount: 2 }),
];

const m = (level: AdMetricRow['level'], id: string, date: string, spend: number, installs = 0): AdMetricRow => ({
  channel: 'apple_ads',
  level,
  external_id: id,
  campaign_external_id: 'C1',
  date,
  spend,
  currency: 'USD',
  impressions: 100,
  taps: 5,
  installs,
});

const METRICS = [m('campaign', 'C1', '2026-10-24', 20, 4), m('ad_group', 'G1', '2026-10-24', 20, 4), m('keyword', 'K1', '2026-10-24', 15, 3), m('keyword', 'K2', '2026-10-24', 5, 1)];

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

const u = (id: string, a: AttributionRow | null, paid = false): CohortUser => ({
  userId: id,
  signupAt: '2026-10-24T15:00:00Z',
  signupDate: '2026-10-24',
  attribution: a ? { ...a, user_id: id } : null,
  firstActivityAt: '2026-10-24T16:00:00Z',
  events: paid ? [{ user_id: id, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: '2026-10-24T17:00:00Z', raw: { price: 10, takehome_percentage: 1 } }] : [],
});

const COHORT = [
  u('a', attr({}), true),
  u('b', attr({ keyword_external_id: 'K2' })),
  u('c', attr({ keyword_external_id: null })), // Search Match / no keyword
  u('d', attr({ channel: 'organic', campaign_external_id: null, ad_group_external_id: null, keyword_external_id: null })),
  u('e', null), // older app version → unknown
  u('t', attr({ campaign_external_id: '1234567890', is_test: true })), // Apple mock payload
];

const input = (over: Partial<SliceInput> = {}): SliceInput => ({ metricRows: METRICS, entities: ENTITIES, cohort: COHORT, rangeEnd: '2026-10-24', today: '2026-10-24', ...over });

describe('buildRows', () => {
  it('by channel: spend on campaign level only, organic and unknown kept separate, test users → unknown', () => {
    const rows = buildRows('channel', input());
    const by = Object.fromEntries(rows.map((r) => [r.key, r.metrics]));
    expect(by.apple_ads).toMatchObject({ spend: 20, installs: 4, users: 3, payers: 1, revenueToDate: 10, cpi: 5 });
    expect(by.apple_ads.costPerPayer).toBe(20);
    expect(by.apple_ads.roasToDate).toBe(0.5);
    expect(by.organic).toMatchObject({ spend: 0, users: 1, costPerUser: 0, cpi: null });
    expect(by.unknown.users).toBe(2);
  });

  it('by keyword: each keyword + an unattributed bucket for users without one', () => {
    const rows = buildRows('keyword', input());
    const k1 = rows.find((r) => r.externalId === 'K1')!;
    expect(k1).toMatchObject({ label: 'calorie counter', sublabel: 'US Search › Snap a meal', level: 'keyword' });
    expect(k1.metrics).toMatchObject({ spend: 15, users: 1, payers: 1, costPerUser: 15 });
    expect(rows.find((r) => r.externalId === 'K2')!.metrics).toMatchObject({ spend: 5, users: 1 });
    expect(rows.find((r) => r.key === 'apple_ads:none')!.metrics.users).toBe(1);
    expect(rows.find((r) => r.key === 'organic:none')!.label).toBe('Organic');
  });

  it('entities without delivery still show (campaign started today)', () => {
    const rows = buildRows('campaign', input({ metricRows: [], cohort: [] }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'US Search', externalId: 'C1' });
    expect(rows[0].metrics.spend).toBe(0);
    expect(rows[0].metrics.cpi).toBeNull();
    expect(rows[0].metrics.incomplete.d7).toBe(true);
  });

  it('by platform', () => {
    const rows = buildRows('platform', input());
    expect(rows.find((r) => r.key === 'ios')!.metrics.spend).toBe(20);
  });

  it('campaign filter', () => {
    const rows = buildRows('ad_group', input({ filter: { channel: 'apple_ads', campaignExternalId: 'C1' } }));
    expect(rows.map((r) => r.key).sort()).toEqual(['apple_ads:ad_group:G1']);
    expect(rows[0].metrics.users).toBe(3);
  });
});

describe('totals + timeseries', () => {
  it('totals: all spend, all non-test users', () => {
    expect(buildTotals(input()).metrics).toMatchObject({ spend: 20, users: 6, payers: 1 });
  });
  it('timeseries per day with cumulative ROAS', () => {
    const pts = buildTimeseries('2026-10-23', '2026-10-24', input());
    expect(pts[0]).toMatchObject({ date: '2026-10-23', spend: 0, users: 0, cumulativeRoas: null });
    expect(pts[1]).toMatchObject({ date: '2026-10-24', spend: 20, users: 6, payers: 1, revenue: 10, cumulativeRoas: 0.5, activated: 6 });
  });
});

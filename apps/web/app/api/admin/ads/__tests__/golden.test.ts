/**
 * GOLDEN end-to-end test: a hand-built world goes through the real routes
 * (GET /api/admin/ads/overview, /timeseries) over the in-memory Supabase, and
 * every KPI is asserted exactly against arithmetic done by hand below.
 * If this test fails, a metric changed meaning — update the methodology doc
 * (docs/ADS_METRICS_METHODOLOGY.md) together with the expectations.
 *
 * Clock: 2026-10-24 12:00 New York. Range 2026-10-01 … 2026-10-10 (10 days),
 * report time zone America/New_York (EDT, UTC−4 for all of October).
 *   → range end is 14 days old: activation / D7 complete, D30 incomplete.
 *
 * ─── Delivery (identical every day, 10 days) ──────────────────────────────
 * Apple campaign C1 "US Search"
 *   ad group G1: spend 6.00  impr 300  taps 15  installs 3
 *     keyword K1: 3.50 / 200 / 10 / 2     keyword K2: 1.50 / 60 / 3 / 1
 *     → Search Match (no keyword) on G1: 1.00 / 40 / 2 / 0
 *   ad group G2: spend 4.00  impr 200  taps 10  installs 2
 *     keyword K3: 4.00 / 200 / 10 / 2
 *   campaign C1 = G1 + G2: 10.00 / 500 / 25 / 5 per day → 100.00 / 5000 / 250 / 50
 * Meta campaign M1, ad set S1: 3.00 / 1000 / 20 / 1 per day → 30.00 / 10000 / 200 / 10
 * TOTAL: spend 130.00, impressions 15000, taps 450, installs 60.
 *
 * ─── Users (signup UTC → New York day) ────────────────────────────────────
 *  A apple K1   10-01 14:00Z (10-01) food log +1h → activated.
 *               INITIAL_PURCHASE monthly $9.99, tax 0, commission 0.15
 *               → 9.99 × 0.85 = 8.4915 → $8.49 (D7, D30, to date)
 *  B apple K1   10-02 13:00Z (10-02) manual check-in +23h → activated.
 *               TRIAL INITIAL_PURCHASE $0 at +10 min (trial, not revenue)
 *               RENEWAL (trial conversion) annual $29.99 at +7d 10min, commission 0.15
 *               → 29.99 × 0.85 = 25.4915 → $25.49; 7d10m ≥ 7d → NOT D7; in D30
 *  C apple K3   10-03 16:00Z (10-03) no activity → not activated.
 *               NON_RENEWING_PURCHASE lifetime $179.99 at +1d, only takehome 0.85
 *               → 179.99 × 0.85 = 152.9915 → $152.99 (D7)
 *  D apple G1, no keyword (Search Match)  10-04 18:00Z (10-04) food log next day → activated.
 *               INITIAL_PURCHASE annual $29.99 at +30 min, tax 0.20 + commission 0.15
 *               → 29.99 × 0.65 = 19.4935 → $19.49
 *               CANCELLATION CUSTOMER_SUPPORT price −29.99 (same tx) at +1d6h → −$19.49
 *               net $0 (both inside D7) → NOT a payer
 *  E apple K3   10-05 20:00Z (10-05)
 *               INITIAL_PURCHASE monthly $9.99 commission 0.15 → $8.49 (D7)
 *               + the SAME transaction re-delivered under another event id → dropped
 *               + a SANDBOX $179.99 purchase → not loaded / not counted
 *               only a HealthKit food import + HealthKit step sync → NOT activated
 *  F apple C1 only (RevenueCat fallback, no ad group)  10-06 15:00Z (10-06)
 *               food log at +6d23h → activated (< 7 × 24 h)
 *  G meta S1    10-07 15:00Z (10-07) food log → activated, no purchase
 *  H organic    10-08 15:00Z (10-08) food log → activated; $9.99 takehome 0.85 → $8.49
 *  I no attribution row → unknown  10-09 15:00Z; Family Sharing $29.99 copy → $0, not payer
 *  J attribution row channel unknown  10-10 03:30Z = 10-09 23:30 NY → in range
 *  N apple K1   10-11 03:30Z = 10-10 23:30 NY → in range (last cohort day); nothing else
 *  excluded: T1 Apple mock attribution (is_test) with a $9.99 purchase;
 *            T2 internal email (@inov8rlabs.com) apple K1 with a $9.99 purchase;
 *            O  10-11 04:30Z = 10-11 00:30 NY → outside the range.
 *
 * ─── Expected, by hand ────────────────────────────────────────────────────
 * Apple:  users A B C D E F N = 7; activated A B D F = 4; trials B = 1;
 *         payers A B C E = 4 (D refunded)
 *         revenue to date 8.49 + 25.49 + 152.99 + 0 + 8.49 = 195.46
 *         revenue D7  8.49 + 0 + 152.99 + 0 + 8.49 = 169.97;  D30 = 169.97 + 25.49 = 195.46
 * Meta:   users G = 1, activated 1, payers 0, revenue 0
 * Totals (paid channels only): users 8, activated 5, trials 1, payers 4,
 *         D7 169.97, D30 195.46, to date 195.46
 *   cpt 130/450 = 0.2888…   ttr 450/15000 = 0.03   cpi 130/60 = 2.1666…
 *   cost/user 130/8 = 16.25   cost/activated 130/5 = 26   CAC 130/4 = 32.50
 *   ROAS D7 169.97/130 = 1.30746…   D30 = to date = 195.46/130 = 1.50353…
 *   install→user 8/60 = 0.1333…   user→activated 5/8 = 0.625   user→payer 4/8 = 0.5
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { setConnectorsForTest } from '@/lib/ads/connectors';
import type { AdsConnector } from '@/lib/ads/connectors/types';
import { eachDay } from '@/lib/ads/dates';

import { GET as overview } from '../overview/route';
import { GET as timeseries } from '../timeseries/route';

const DAYS = eachDay('2026-10-01', '2026-10-10');
const call = async (handler: (r: NextRequest) => Promise<Response>, path: string) => {
  const res = await handler(new NextRequest(`https://www.fitcircle.ai${path}`, { headers: { authorization: 'Bearer golden-secret' } }));
  expect(res.status).toBe(200);
  return (await res.json()).data;
};
const configured = (channel: 'apple_ads' | 'meta'): AdsConnector =>
  ({ channel, isConfigured: () => true, fetchEntities: async () => [], fetchDailyMetrics: async () => [], readEntity: async () => null, applyChange: async () => ({ confirmedValue: null, entity: null }) }) as AdsConnector;

function seed(db: AdsFakeDb) {
  const entity = (channel: string, level: string, id: string, parent: string | null, campaign: string, name: string) => ({
    channel,
    platform: channel === 'apple_ads' ? 'ios' : 'android',
    level,
    external_id: id,
    parent_external_id: parent,
    campaign_external_id: campaign,
    name,
    status: 'ENABLED',
    serving_status: 'RUNNING',
    bid_strategy: 'MANUAL_CPT',
    bid_amount: level === 'keyword' ? 2 : null,
    bid_currency: 'USD',
    daily_budget: level === 'campaign' ? 20 : null,
    total_budget: null,
    match_type: level === 'keyword' ? 'EXACT' : null,
    countries: ['US'],
    start_at: null,
    end_at: null,
    creative: null,
    raw: {},
    synced_at: '2026-10-24T15:30:00Z',
  });
  db.rows('ad_entities').push(
    entity('apple_ads', 'campaign', 'C1', null, 'C1', 'US Search'),
    entity('apple_ads', 'ad_group', 'G1', 'C1', 'C1', 'Snap a meal'),
    entity('apple_ads', 'ad_group', 'G2', 'C1', 'C1', 'Macros'),
    entity('apple_ads', 'keyword', 'K1', 'G1', 'C1', 'calorie counter'),
    entity('apple_ads', 'keyword', 'K2', 'G1', 'C1', 'food diary'),
    entity('apple_ads', 'keyword', 'K3', 'G2', 'C1', 'macro tracker'),
    entity('meta', 'campaign', 'M1', null, 'M1', 'Android installs'),
    entity('meta', 'ad_group', 'S1', 'M1', 'M1', 'Broad US')
  );
  const m = (channel: string, level: string, id: string, campaign: string, date: string, spend: number, impressions: number, taps: number, installs: number) => ({
    channel,
    level,
    external_id: id,
    campaign_external_id: campaign,
    date,
    spend,
    currency: 'USD',
    impressions,
    taps,
    installs,
    new_downloads: installs,
    redownloads: 0,
    synced_at: '2026-10-24T15:30:00Z',
  });
  for (const d of DAYS) {
    db.rows('ad_metrics_daily').push(
      m('apple_ads', 'campaign', 'C1', 'C1', d, 10, 500, 25, 5),
      m('apple_ads', 'ad_group', 'G1', 'C1', d, 6, 300, 15, 3),
      m('apple_ads', 'ad_group', 'G2', 'C1', d, 4, 200, 10, 2),
      m('apple_ads', 'keyword', 'K1', 'C1', d, 3.5, 200, 10, 2),
      m('apple_ads', 'keyword', 'K2', 'C1', d, 1.5, 60, 3, 1),
      m('apple_ads', 'keyword', 'K3', 'C1', d, 4, 200, 10, 2),
      m('meta', 'campaign', 'M1', 'M1', d, 3, 1000, 20, 1),
      m('meta', 'ad_group', 'S1', 'M1', d, 3, 1000, 20, 1)
    );
  }
  // Outside the range: must not count.
  db.rows('ad_metrics_daily').push(m('apple_ads', 'campaign', 'C1', 'C1', '2026-10-11', 999, 1, 1, 1), m('apple_ads', 'campaign', 'C1', 'C1', '2026-09-30', 999, 1, 1, 1));

  const id = (c: string) => `00000000-0000-4000-8000-0000000000${c}`;
  const profile = (k: string, created_at: string, email = `${k.toLowerCase()}.user@gmail.com`) => db.rows('profiles').push({ id: id(k), created_at, email, is_admin: false });
  const attr = (k: string, channel: string, source: string, campaign: string | null, adGroup: string | null, keyword: string | null, is_test = false) =>
    db.rows('user_attribution').push({ user_id: id(k), channel, platform: channel === 'meta' ? 'android' : 'ios', source, campaign_external_id: campaign, ad_group_external_id: adGroup, keyword_external_id: keyword, ad_external_id: null, click_at: null, country: 'US', is_test, raw: null });
  let n = 0;
  const event = (k: string, type: string, at: string, raw: Record<string, unknown>, opts: { environment?: string; store?: string; id?: string } = {}) =>
    db.rows('subscription_events').push({
      id: opts.id ?? `evt-${++n}`,
      user_id: id(k),
      type,
      store: opts.store ?? 'APP_STORE',
      environment: opts.environment ?? 'PRODUCTION',
      event_timestamp: at,
      raw: { environment: opts.environment ?? 'PRODUCTION', period_type: 'NORMAL', currency: 'USD', ...raw },
    });
  const food = (k: string, at: string, input_method: string | null = 'photo') => db.rows('food_log_entries').push({ id: `f-${++n}`, user_id: id(k), created_at: at, input_method });
  const checkin = (k: string, at: string, steps_source = 'manual') => db.rows('daily_tracking').push({ id: `d-${++n}`, user_id: id(k), created_at: at, steps_source });

  profile('0A', '2026-10-01T14:00:00Z');
  attr('0A', 'apple_ads', 'apple_search_ads', 'C1', 'G1', 'K1');
  food('0A', '2026-10-01T15:00:00Z');
  event('0A', 'INITIAL_PURCHASE', '2026-10-01T14:30:00Z', { product_id: 'monthly', price: 9.99, tax_percentage: 0, commission_percentage: 0.15, transaction_id: 'tA' });

  profile('0B', '2026-10-02T13:00:00Z');
  attr('0B', 'apple_ads', 'apple_search_ads', 'C1', 'G1', 'K1');
  checkin('0B', '2026-10-03T12:00:00Z');
  event('0B', 'INITIAL_PURCHASE', '2026-10-02T13:10:00Z', { product_id: 'annual', price: 0, period_type: 'TRIAL', tax_percentage: 0, commission_percentage: 0.15, transaction_id: 'tB0' });
  event('0B', 'RENEWAL', '2026-10-09T13:10:00Z', { product_id: 'annual', price: 29.99, is_trial_conversion: true, tax_percentage: 0, commission_percentage: 0.15, transaction_id: 'tB1' });

  profile('0C', '2026-10-03T16:00:00Z');
  attr('0C', 'apple_ads', 'apple_search_ads', 'C1', 'G2', 'K3');
  event('0C', 'NON_RENEWING_PURCHASE', '2026-10-04T16:00:00Z', { product_id: 'lifetime', price: 179.99, takehome_percentage: 0.85, transaction_id: 'tC' });

  profile('0D', '2026-10-04T18:00:00Z');
  attr('0D', 'apple_ads', 'apple_search_ads', 'C1', 'G1', null);
  food('0D', '2026-10-05T12:00:00Z');
  event('0D', 'INITIAL_PURCHASE', '2026-10-04T18:30:00Z', { product_id: 'annual', price: 29.99, tax_percentage: 0.2, commission_percentage: 0.15, transaction_id: 'tD' });
  event('0D', 'CANCELLATION', '2026-10-06T00:00:00Z', { product_id: 'annual', price: -29.99, cancel_reason: 'CUSTOMER_SUPPORT', tax_percentage: 0.2, commission_percentage: 0.15, transaction_id: 'tD' });

  profile('0E', '2026-10-05T20:00:00Z');
  attr('0E', 'apple_ads', 'apple_search_ads', 'C1', 'G2', 'K3');
  food('0E', '2026-10-05T21:00:00Z', 'imported');
  checkin('0E', '2026-10-05T21:00:00Z', 'healthkit');
  event('0E', 'INITIAL_PURCHASE', '2026-10-05T20:10:00Z', { product_id: 'monthly', price: 9.99, tax_percentage: 0, commission_percentage: 0.15, transaction_id: 'tE' });
  event('0E', 'INITIAL_PURCHASE', '2026-10-05T20:11:00Z', { product_id: 'monthly', price: 9.99, tax_percentage: 0, commission_percentage: 0.15, transaction_id: 'tE' });
  event('0E', 'NON_RENEWING_PURCHASE', '2026-10-05T20:20:00Z', { product_id: 'lifetime', price: 179.99, takehome_percentage: 0.85, transaction_id: 'sbx' }, { environment: 'SANDBOX' });

  profile('0F', '2026-10-06T15:00:00Z');
  attr('0F', 'apple_ads', 'revenuecat', 'C1', null, null);
  food('0F', '2026-10-13T14:00:00Z'); // 6 d 23 h after sign-up

  profile('0G', '2026-10-07T15:00:00Z');
  attr('0G', 'meta', 'play_install_referrer', 'M1', 'S1', null);
  food('0G', '2026-10-07T16:00:00Z');

  profile('0H', '2026-10-08T15:00:00Z');
  attr('0H', 'organic', 'play_install_referrer', null, null, null);
  food('0H', '2026-10-08T16:00:00Z');
  event('0H', 'INITIAL_PURCHASE', '2026-10-08T16:00:00Z', { product_id: 'monthly', price: 9.99, takehome_percentage: 0.85, transaction_id: 'tH' }, { store: 'PLAY_STORE' });

  profile('0I', '2026-10-09T15:00:00Z');
  event('0I', 'INITIAL_PURCHASE', '2026-10-09T16:00:00Z', { product_id: 'annual', price: 29.99, is_family_share: true, takehome_percentage: 0.85, transaction_id: 'tI' });

  profile('0J', '2026-10-10T03:30:00Z');
  attr('0J', 'unknown', 'app', null, null, null);

  profile('0N', '2026-10-11T03:30:00Z');
  attr('0N', 'apple_ads', 'apple_search_ads', 'C1', 'G1', 'K1');

  // Excluded.
  profile('T1', '2026-10-02T15:00:00Z');
  attr('T1', 'apple_ads', 'apple_search_ads', '1234567890', null, null, true);
  event('T1', 'INITIAL_PURCHASE', '2026-10-02T15:10:00Z', { price: 9.99, takehome_percentage: 0.85, transaction_id: 'tT1' });
  profile('T2', '2026-10-03T15:00:00Z', 'ani@inov8rlabs.com');
  attr('T2', 'apple_ads', 'apple_search_ads', 'C1', 'G1', 'K1');
  event('T2', 'INITIAL_PURCHASE', '2026-10-03T15:10:00Z', { price: 9.99, takehome_percentage: 0.85, transaction_id: 'tT2' });
  profile('0O', '2026-10-11T04:30:00Z');
  attr('0O', 'apple_ads', 'apple_search_ads', 'C1', 'G1', 'K1');
  event('0O', 'INITIAL_PURCHASE', '2026-10-11T05:00:00Z', { price: 179.99, takehome_percentage: 0.85, transaction_id: 'tO' });

  // Sync runs: Apple fresh (30 min), Meta last success 4 h ago (stale > 2 h).
  db.rows('ad_sync_runs').push(
    { id: 'r1', channel: 'apple_ads', trigger: 'cron', started_at: '2026-10-24T15:29:00Z', finished_at: '2026-10-24T15:30:00Z', ok: true, error: null },
    { id: 'r2', channel: 'meta', trigger: 'cron', started_at: '2026-10-24T11:59:00Z', finished_at: '2026-10-24T12:00:00Z', ok: true, error: null }
  );
}

describe('GOLDEN: hand-computed KPIs through the real overview / timeseries routes', () => {
  const RANGE = 'start=2026-10-01&end=2026-10-10';
  beforeAll(() => {
    vi.useFakeTimers({ now: new Date('2026-10-24T16:00:00Z'), toFake: ['Date'] });
    process.env.ADMIN_API_SECRET = 'golden-secret';
    process.env.ADS_REPORT_TIMEZONE = 'America/New_York';
    delete process.env.ADS_TEST_EMAILS;
    delete process.env.ADS_TEST_EMAIL_DOMAINS;
    const db = new AdsFakeDb();
    seed(db);
    setAdsDb(db);
    setConnectorsForTest({ apple_ads: configured('apple_ads'), meta: configured('meta') });
  });
  afterAll(() => {
    vi.useRealTimers();
    setConnectorsForTest(null);
  });

  it('totals (paid channels only)', async () => {
    const data = await call(overview, `/api/admin/ads/overview?${RANGE}&groupBy=channel`);
    const t = data.totals.metrics;
    expect(t).toMatchObject({
      spend: 130,
      currency: 'USD',
      mixedCurrency: false,
      impressions: 15000,
      taps: 450,
      installs: 60,
      users: 8,
      activated: 5,
      trials: 1,
      payers: 4,
      revenueD7: 169.97,
      revenueD30: 195.46,
      revenueToDate: 195.46,
      costPerUser: 16.25,
      costPerActivated: 26,
      costPerPayer: 32.5,
      ttr: 0.03,
      userToActivated: 0.625,
      userToPayer: 0.5,
      incomplete: { activated: false, d7: false, d30: true },
    });
    expect(t.cpt).toBeCloseTo(130 / 450, 12);
    expect(t.cpi).toBeCloseTo(130 / 60, 12);
    expect(t.roasD7).toBeCloseTo(169.97 / 130, 12);
    expect(t.roasD30).toBeCloseTo(195.46 / 130, 12);
    expect(t.roasToDate).toBeCloseTo(195.46 / 130, 12);
    expect(t.installToUser).toBeCloseTo(8 / 60, 12);
    expect(data.excludedUsers).toEqual({ total: 2, byReason: { internal: 1, mock_attribution: 1 }, included: false });
  });

  it('by channel', async () => {
    const data = await call(overview, `/api/admin/ads/overview?${RANGE}&groupBy=channel`);
    const by = Object.fromEntries(data.rows.map((r: any) => [r.key, r.metrics]));
    expect(Object.keys(by).sort()).toEqual(['apple_ads', 'meta', 'organic', 'unknown']);
    expect(by.apple_ads).toMatchObject({ spend: 100, impressions: 5000, taps: 250, installs: 50, users: 7, activated: 4, trials: 1, payers: 4, revenueD7: 169.97, revenueD30: 195.46, revenueToDate: 195.46, cpi: 2, costPerPayer: 25, cpt: 0.4 });
    expect(by.apple_ads.roasToDate).toBeCloseTo(1.9546, 12); // 195.46 / 100
    expect(by.apple_ads.costPerUser).toBeCloseTo(100 / 7, 12);
    expect(by.meta).toMatchObject({ spend: 30, installs: 10, users: 1, activated: 1, payers: 0, revenueToDate: 0, cpi: 3, costPerUser: 30, costPerPayer: null, roasToDate: 0 });
    expect(by.organic).toMatchObject({ spend: 0, users: 1, activated: 1, payers: 1, revenueToDate: 8.49, roasToDate: null, costPerPayer: 0 });
    // I (family share copy) + J; no payer, no revenue.
    expect(by.unknown).toMatchObject({ users: 2, activated: 0, payers: 0, revenueToDate: 0 });
  });

  it('by keyword (Search Match remainder in the unattributed row; rows add up to totals)', async () => {
    const data = await call(overview, `/api/admin/ads/overview?${RANGE}&groupBy=keyword`);
    const by = Object.fromEntries(data.rows.map((r: any) => [r.key, r.metrics]));
    // K1: 3.50 × 10 = 35.00; users A B N; payers A B; revenue 8.49 + 25.49 = 33.98; CAC 35 / 2 = 17.50
    expect(by['apple_ads:keyword:K1']).toMatchObject({ spend: 35, installs: 20, users: 3, payers: 2, revenueToDate: 33.98, costPerPayer: 17.5 });
    expect(by['apple_ads:keyword:K2']).toMatchObject({ spend: 15, installs: 10, users: 0, payers: 0, costPerUser: null });
    // K3: 40.00; users C E; revenue 152.99 + 8.49 = 161.48
    expect(by['apple_ads:keyword:K3']).toMatchObject({ spend: 40, installs: 20, users: 2, payers: 2, revenueToDate: 161.48, costPerPayer: 20 });
    // Search Match: 100 − 35 − 15 − 40 = 10.00; impressions (300−200−60)×10 = 400; taps (15−10−3)×10 = 20; installs 0. Users D (G1, no kw), F (campaign only).
    expect(by['apple_ads:none']).toMatchObject({ spend: 10, impressions: 400, taps: 20, installs: 0, users: 2, activated: 2, payers: 0 });
    expect(by['meta:none']).toMatchObject({ spend: 30, installs: 10, users: 1 });
    const sumSpend = data.rows.reduce((s: number, r: any) => s + Math.round(r.metrics.spend * 100), 0) / 100;
    expect(sumSpend).toBe(130);
  });

  it('by ad group', async () => {
    const data = await call(overview, `/api/admin/ads/overview?${RANGE}&groupBy=ad_group`);
    const by = Object.fromEntries(data.rows.map((r: any) => [r.key, r.metrics]));
    // G1: users A B D N, payers A B; G2: users C E, payers C E; F has no ad group.
    expect(by['apple_ads:ad_group:G1']).toMatchObject({ spend: 60, installs: 30, users: 4, activated: 3, payers: 2, revenueToDate: 33.98, costPerPayer: 30 });
    expect(by['apple_ads:ad_group:G2']).toMatchObject({ spend: 40, installs: 20, users: 2, activated: 0, payers: 2, revenueToDate: 161.48 });
    expect(by['apple_ads:none']).toMatchObject({ spend: 0, users: 1, activated: 1 });
    expect(by['meta:ad_group:S1']).toMatchObject({ spend: 30, users: 1 });
  });

  it('timeseries: spend by report day, users / payers / revenue by sign-up day', async () => {
    const data = await call(timeseries, `/api/admin/ads/timeseries?${RANGE}`);
    expect(data.points.map((p: any) => p.spend)).toEqual(Array(10).fill(13));
    expect(data.points.map((p: any) => p.installs)).toEqual(Array(10).fill(6));
    // A B C D E F G(meta) – – N   (H organic, I/J unknown are not paid)
    expect(data.points.map((p: any) => p.users)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0, 1]);
    expect(data.points.map((p: any) => p.payers)).toEqual([1, 1, 1, 0, 1, 0, 0, 0, 0, 0]);
    expect(data.points.map((p: any) => p.revenue)).toEqual([8.49, 25.49, 152.99, 0, 8.49, 0, 0, 0, 0, 0]);
    expect(data.points[0].cumulativeRoas).toBeCloseTo(8.49 / 13, 12);
    expect(data.points[2].cumulativeRoas).toBeCloseTo((8.49 + 25.49 + 152.99) / 39, 12);
    expect(data.points[9].cumulativeRoas).toBeCloseTo(195.46 / 130, 12);
  });

  it('dataHealth', async () => {
    const { dataHealth: h } = await call(overview, `/api/admin/ads/overview?${RANGE}`);
    expect(h.sync).toEqual([
      { channel: 'apple_ads', configured: true, lastSuccessAt: '2026-10-24T15:30:00Z', ageMinutes: 30, lastRunFailed: false, lastError: null, status: 'ok' },
      { channel: 'meta', configured: true, lastSuccessAt: '2026-10-24T12:00:00Z', ageMinutes: 240, lastRunFailed: false, lastError: null, status: 'warn' },
    ]);
    // 10 Apple + 10 Meta campaign-days, all reconcile; keyword coverage (35 + 15 + 40) / 100 = 90%.
    expect(h.spend).toEqual({ status: 'ok', campaignDays: 20, mismatchedCampaignDays: 0, mismatches: [], totalAbsDiff: 0, keywordCoveragePct: 90, keywordSpend: 90, appleCampaignSpend: 100 });
    // 8 attributed paid users / 60 paid installs = 13.3%.
    expect(h.attribution).toMatchObject({ status: 'warn', paidInstalls: 60, attributedPaidUsers: 8, coveragePct: 13.3, bySource: { apple_search_ads: 6, revenuecat: 1, play_install_referrer: 1 } });
    // Revenue events: A1, B1 (renewal), C1, D2, E1, H1 = 7. Without takehome_percentage: A, B, D×2, E = 5.
    expect(h.revenue).toEqual({ status: 'ok', revenueEvents: 7, missingTakehome: 5, fallbackRateUsed: 0, missingPrice: 0, familyShareExcluded: 1, duplicatesDropped: 1 });
    expect(h.currency).toEqual({ status: 'ok', mixedCurrency: false, currencies: ['USD'] });
    expect(h.status).toBe('warn');
    expect(h.checks.find((c: any) => c.key === 'sync').reasons[0]).toMatch(/Meta: last successful sync 4 h ago \(stale\)/);
  });
});

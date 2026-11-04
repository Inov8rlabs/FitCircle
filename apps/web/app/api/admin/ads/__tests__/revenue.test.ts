/**
 * Ad revenue end to end over the fake DB: the AdMob sync (window replace, run
 * log, first-run backfill) and GET /api/admin/ads/revenue (totals, ARPDAU,
 * breakdowns, channel returns with the allocation estimate, blended ROAS,
 * test-user exclusion, auth and validation).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import type { AdmobClient, AdRevenueDailyInput } from '@/lib/ads/admob/client';
import type { AdsRevenueReport } from '@/lib/ads/services/ad-revenue-report-service';
import { AdRevenueSyncService } from '@/lib/ads/services/ad-revenue-sync-service';

import { GET as revenue } from '../revenue/route';

let db: AdsFakeDb;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [APPLE_USER, GOOGLE_USER, ORGANIC, TESTER] = [1, 2, 3, 4].map(id);

const get = async (q: string, auth = 'Bearer rsecret') => {
  const res = await revenue(new NextRequest(`https://www.fitcircle.ai/api/admin/ads/revenue?${q}`, { headers: { authorization: auth } }));
  return { status: res.status, body: (await res.json()) as { success: boolean; data: AdsRevenueReport } };
};

const rev = (date: string, platform: 'ios' | 'android', earnings: number, over: Partial<Record<string, unknown>> = {}) => ({
  source: 'admob',
  date,
  app_id: platform === 'ios' ? 'ca-app-pub-1~2129238766' : 'ca-app-pub-1~2735230071',
  app_name: 'FitCircle',
  platform,
  ad_unit_id: platform === 'ios' ? 'unit-ios' : 'unit-android',
  ad_unit_name: platform === 'ios' ? 'Home native iOS' : 'Home native Android',
  format: 'NATIVE',
  country: 'US',
  currency: 'USD',
  estimated_earnings: earnings,
  ad_requests: 10,
  matched_requests: 8,
  impressions: 5,
  clicks: 1,
  synced_at: '2026-11-05T00:00:00Z',
  ...over,
});

const feed = (n: number, user: string, platform: string, at: string) => ({ id: `f${n}`, user_id: user, platform, created_at: at });

const fakeClient = (rows: AdRevenueDailyInput[], configured = true) =>
  ({ isConfigured: () => configured, publisherId: () => (configured ? 'pub-1808316612259930' : null), networkReport: vi.fn(async () => ({ rows, currency: 'USD', matchingRowCount: rows.length })) }) as unknown as AdmobClient;

const realClient = AdRevenueSyncService.client;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T18:00:00Z'), toFake: ['Date'] });
  process.env.ADMIN_API_SECRET = 'rsecret';
  delete process.env.ADS_REPORT_TIMEZONE;
  db = new AdsFakeDb();
  setAdsDb(db);
  AdRevenueSyncService.client = () => fakeClient([]);
  db.rows('profiles').push(
    { id: APPLE_USER, email: 'ann.real@gmail.com', is_admin: false, created_at: '2026-11-02T15:00:00Z' },
    { id: GOOGLE_USER, email: 'gus@yahoo.com', is_admin: false, created_at: '2026-11-02T16:00:00Z' },
    { id: ORGANIC, email: 'olive@icloud.com', is_admin: false, created_at: '2026-11-02T17:00:00Z' },
    { id: TESTER, email: 'qa@example.com', is_admin: false, created_at: '2026-11-02T17:30:00Z' }
  );
  db.rows('user_attribution').push(
    { user_id: APPLE_USER, channel: 'apple_ads', platform: 'ios', source: 'apple_search_ads', campaign_external_id: 'c1', ad_group_external_id: null, keyword_external_id: null, ad_external_id: null, click_at: null, country: 'US', is_test: false, raw: null },
    { user_id: GOOGLE_USER, channel: 'google_ads', platform: 'android', source: 'google_ads_ga4', campaign_external_id: 'g1', ad_group_external_id: null, keyword_external_id: null, ad_external_id: null, click_at: null, country: 'US', is_test: false, raw: null }
  );
  db.rows('ad_entities').push(
    { channel: 'apple_ads', platform: 'ios', level: 'campaign', external_id: 'c1', parent_external_id: null, campaign_external_id: 'c1', name: 'Apple', status: 'ENABLED', synced_at: '2026-11-05T00:00:00Z' },
    { channel: 'google_ads', platform: 'android', level: 'campaign', external_id: 'g1', parent_external_id: null, campaign_external_id: 'g1', name: 'Google', status: 'ENABLED', synced_at: '2026-11-05T00:00:00Z' }
  );
  db.rows('ad_metrics_daily').push(
    { channel: 'apple_ads', level: 'campaign', external_id: 'c1', campaign_external_id: 'c1', date: '2026-11-02', spend: 20, currency: 'USD', impressions: 100, taps: 10, installs: 4 },
    { channel: 'google_ads', level: 'campaign', external_id: 'g1', campaign_external_id: 'g1', date: '2026-11-02', spend: 30, currency: 'USD', impressions: 1000, taps: 20, installs: 5 }
  );
  db.rows('subscription_events').push({
    id: 'e1',
    user_id: APPLE_USER,
    type: 'INITIAL_PURCHASE',
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    event_timestamp: '2026-11-03T15:00:00Z',
    raw: { price: 9.99, takehome_percentage: 0.85, transaction_id: 't1', period_type: 'NORMAL' },
  });
  db.rows('home_feed_decisions').push(
    feed(1, APPLE_USER, 'ios', '2026-11-02T18:00:00Z'),
    feed(2, APPLE_USER, 'ios', '2026-11-02T19:00:00Z'), // same day: counted once
    feed(3, APPLE_USER, 'ios', '2026-11-03T18:00:00Z'),
    feed(4, GOOGLE_USER, 'android', '2026-11-02T18:00:00Z'),
    feed(5, ORGANIC, 'android', '2026-11-02T18:00:00Z'),
    feed(6, TESTER, 'android', '2026-11-02T18:00:00Z') // test user: not a DAU
  );
  db.rows('ad_revenue_daily').push(rev('2026-11-02', 'android', 0.3), rev('2026-11-02', 'ios', 0.1), rev('2026-11-03', 'ios', 0.2, { country: 'CA' }));
});

afterEach(() => {
  vi.useRealTimers();
  AdRevenueSyncService.client = realClient;
});

describe('GET /api/admin/ads/revenue', () => {
  it('admin only; validates platform', async () => {
    expect((await get('start=2026-11-01&end=2026-11-04', 'Bearer nope')).status).toBe(401);
    expect((await get('start=2026-11-01&end=2026-11-04&platform=web')).status).toBe(400);
  });

  it('totals, rates, DAU and ARPDAU', async () => {
    const { status, body } = await get('start=2026-11-01&end=2026-11-04');
    expect(status).toBe(200);
    const r = body.data;
    expect(r.estimated).toBe(true);
    expect(r.adRevenueTimeZone).toBe('America/Los_Angeles');
    expect(r.totals.earnings).toBeCloseTo(0.6, 6);
    expect(r.totals.impressions).toBe(15);
    expect(r.totals.matchRate).toBeCloseTo(0.8);
    expect(r.totals.showRate).toBeCloseTo(5 / 8);
    expect(r.totals.ecpm).toBeCloseTo((0.6 / 15) * 1000);
    // DAU: Nov 2 → 2 Android (tester excluded) + 1 iOS, Nov 3 → 1 iOS = 4 user-days.
    expect(r.totals.userDays).toBe(4);
    expect(r.totals.arpdau).toBeCloseTo(0.15);
    // Equal earnings ($0.30 each): more impressions sorts first.
    expect(r.byPlatform.map((p) => p.key)).toEqual(['ios', 'android']);
    for (const p of r.byPlatform) expect(p.arpdau).toBeCloseTo(0.15);
    expect(r.byCountry.map((c) => c.key)).toEqual(['US', 'CA']);
    expect(r.byAdUnit).toHaveLength(2);
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
    expect(r.days[1]).toMatchObject({ spend: 50, dau: 3 });
    expect(r.days[2].subscriptionRevenue).toBeCloseTo(8.49);
    expect(r.source.configured).toBe(true);
    expect(r.source.rowsInRange).toBe(3);
  });

  it('channel returns: subscription revenue + allocated ad revenue (estimate) ÷ spend, plus funnel costs', async () => {
    const { body } = await get('start=2026-11-01&end=2026-11-04');
    const { rows, paid, blended } = body.data.returns;
    const apple = rows.find((x) => x.channel === 'apple_ads')!;
    const google = rows.find((x) => x.channel === 'google_ads')!;
    // Apple user: iOS Nov 2 (0.10 ÷ 1) + Nov 3 (0.20 ÷ 1).
    expect(apple).toMatchObject({ spend: 20, users: 1, subscriptionRevenue: 8.49, adRevenue: 0.3, totalRevenue: 8.79, costPerSignUp: 20, ttr: 0.1, conversionRate: 0.4 });
    expect(apple.roas).toBeCloseTo(8.79 / 20);
    expect(apple.roasSubscriptions).toBeCloseTo(8.49 / 20);
    // Google user: Android Nov 2 (0.30 ÷ 2 DAU).
    expect(google).toMatchObject({ spend: 30, subscriptionRevenue: 0, adRevenue: 0.15, costPerTrial: null });
    expect(google.roas).toBeCloseTo(0.005);
    expect(paid).toMatchObject({ spend: 50, adRevenue: 0.45, subscriptionRevenue: 8.49 });
    expect(blended).toMatchObject({ spend: 50, adRevenue: 0.6, subscriptionRevenue: 8.49, totalRevenue: 9.09 });
    expect(blended.roas).toBeCloseTo(9.09 / 50);
  });

  it('platform filter narrows ad revenue and DAU only', async () => {
    const { body } = await get('start=2026-11-01&end=2026-11-04&platform=ios');
    expect(body.data.platform).toBe('ios');
    expect(body.data.totals.earnings).toBeCloseTo(0.3);
    expect(body.data.totals.userDays).toBe(2);
    expect(body.data.days.every((d) => d.spend === 0 && d.subscriptionRevenue === 0)).toBe(true);
    // Channel returns stay all-platform.
    expect(body.data.returns.rows.find((x) => x.channel === 'google_ads')!.adRevenue).toBe(0.15);
  });

  it('not connected and no rows: ad revenue is null, never 0', async () => {
    AdRevenueSyncService.client = () => fakeClient([], false);
    db.tables.ad_revenue_daily = [];
    const { body } = await get('start=2026-11-01&end=2026-11-04');
    expect(body.data.source.configured).toBe(false);
    expect(body.data.returns.rows.every((x) => x.adRevenue === null)).toBe(true);
    expect(body.data.returns.blended.adRevenue).toBeNull();
    expect(body.data.days.every((d) => d.adRevenue === null && d.arpdau === null)).toBe(true);
    // Subscriptions still count on their own.
    expect(body.data.returns.blended.roas).toBeCloseTo(8.49 / 50);
    expect(body.data.notes[0]).toMatch(/not connected/);
  });
});

describe('AdRevenueSyncService', () => {
  const input = (date: string, earnings: number): AdRevenueDailyInput => ({
    source: 'admob', date, appId: 'a', appName: 'FitCircle', platform: 'android', adUnitId: 'unit-android', adUnitName: 'Home', format: 'NATIVE', country: 'US', currency: 'USD', estimatedEarnings: earnings, adRequests: 1, matchedRequests: 1, impressions: 1, clicks: 0,
  });

  it('skips when not configured', async () => {
    const r = await AdRevenueSyncService.run({ client: fakeClient([], false) });
    expect(r).toMatchObject({ ok: false, skipped: 'not_configured' });
    expect(db.rows('ad_sync_runs')).toHaveLength(0);
  });

  it('first run backfills 90 days; later runs replace today-3 … today (Pacific)', async () => {
    db.tables.ad_revenue_daily = [];
    const first = fakeClient([input('2026-11-04', 0.2)]);
    const r1 = await AdRevenueSyncService.run({ client: first });
    expect(r1).toMatchObject({ ok: true, rows: 1, range: { start: '2026-08-08', end: '2026-11-05' } });
    expect(db.rows('ad_sync_runs')[0]).toMatchObject({ channel: 'admob', ok: true, rows_metrics: 1 });

    // AdMob restated Nov 4 and dropped it in favour of Nov 5: the stale row goes.
    const second = fakeClient([input('2026-11-05', 0.05)]);
    const r2 = await AdRevenueSyncService.run({ client: second });
    expect(r2.range).toEqual({ start: '2026-11-02', end: '2026-11-05' });
    expect(db.rows('ad_revenue_daily').map((r) => [r.date, r.estimated_earnings])).toEqual([['2026-11-05', 0.05]]);
  });

  it('a failing report is logged on the run, not thrown', async () => {
    const bad = { isConfigured: () => true, publisherId: () => 'pub-1', networkReport: async () => { throw new Error('AdMob: HTTP 403 [PERMISSION_DENIED]'); } } as unknown as AdmobClient;
    const r = await AdRevenueSyncService.run({ client: bad });
    expect(r).toMatchObject({ ok: false, error: 'AdMob: HTTP 403 [PERMISSION_DENIED]' });
    expect(db.rows('ad_sync_runs')[0]).toMatchObject({ ok: false, error: 'AdMob: HTTP 403 [PERMISSION_DENIED]' });
    const status = await AdRevenueSyncService.status(bad);
    expect(status).toMatchObject({ configured: true, ok: false, lastSuccessAt: null });
  });
});

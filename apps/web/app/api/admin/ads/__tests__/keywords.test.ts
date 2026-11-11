/** GET /api/admin/ads/keywords: auth, validation, shape and reconciliation with the overview. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getAdsDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { todayInTz } from '@/lib/ads/dates';

import { GET as keywords } from '../keywords/route';
import { GET as overview } from '../overview/route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TZ = 'America/New_York';
let db: AdsFakeDb;

const req = (url: string, as?: string) => new NextRequest(`https://www.fitcircle.ai${url}`, { headers: as ? { authorization: `Bearer user:${as}` } : {} });

const entity = (level: string, id: string, parent: string | null, name: string) => ({
  channel: 'apple_ads',
  platform: 'ios',
  level,
  external_id: id,
  parent_external_id: parent,
  campaign_external_id: 'C1',
  name,
  status: 'ENABLED',
  serving_status: 'RUNNING',
  bid_strategy: 'MANUAL_CPT',
  bid_amount: level === 'keyword' ? 2 : null,
  bid_currency: 'USD',
  daily_budget: null,
  total_budget: null,
  match_type: level === 'keyword' ? 'EXACT' : null,
  countries: null,
  start_at: null,
  end_at: null,
  creative: null,
  raw: {},
  synced_at: '2026-10-24T12:00:00Z',
});

beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
  const today = todayInTz(TZ);
  db.rows('profiles').push(
    { id: ADMIN, is_admin: true, email: 'ani@inov8rlabs.com', created_at: '2026-01-01T00:00:00Z' },
    { id: USER, is_admin: false, email: 'ben.real@gmail.com', created_at: '2026-01-01T00:00:00Z' },
    { id: P1, is_admin: false, email: 'p1.real@gmail.com', created_at: `${today}T15:00:00Z`, onboarding_paywall_at: `${today}T15:05:00Z` },
    { id: P2, is_admin: false, email: 'p2.real@gmail.com', created_at: `${today}T15:00:00Z`, onboarding_paywall_at: null },
    { id: P3, is_admin: false, email: 'p3.real@gmail.com', created_at: `${today}T15:00:00Z`, onboarding_paywall_at: `${today}T15:05:00Z` }
  );
  db.rows('ad_entities').push(entity('campaign', 'C1', null, 'US Search'), entity('ad_group', 'G1', 'C1', 'Snap a meal'), entity('keyword', 'K1', 'G1', 'calorie counter'), entity('keyword', 'K2', 'G1', 'macro app'));
  const metric = (level: string, id: string, spend: number, taps: number, installs: number) => ({ channel: 'apple_ads', level, external_id: id, campaign_external_id: 'C1', date: today, spend, currency: 'USD', impressions: taps * 10, taps, installs });
  db.rows('ad_metrics_daily').push(metric('campaign', 'C1', 30, 12, 5), metric('ad_group', 'G1', 30, 12, 5), metric('keyword', 'K1', 20, 8, 3), metric('keyword', 'K2', 4, 2, 1));
  const a = (user_id: string, keyword: string | null) => ({ user_id, channel: 'apple_ads', platform: 'ios', source: 'apple_search_ads', campaign_external_id: 'C1', ad_group_external_id: 'G1', keyword_external_id: keyword, ad_external_id: null, is_test: false });
  db.rows('user_attribution').push(a(P1, 'K1'), a(P2, 'K2'), a(P3, null));
  db.rows('subscription_events').push(
    { id: 't1', user_id: P1, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: `${today}T15:06:00Z`, raw: { price: 0, period_type: 'TRIAL' } },
    { id: 'r1', user_id: P1, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: `${today}T15:07:00Z`, raw: { price: 9.99, takehome_percentage: 0.85, transaction_id: 'x1' } },
    { id: 's1', user_id: P2, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'SANDBOX', event_timestamp: `${today}T15:06:00Z`, raw: { price: 0, period_type: 'TRIAL' } }
  );
  process.env.ADS_REPORT_TIMEZONE = TZ;
});
afterEach(() => {
  delete process.env.ADS_REPORT_TIMEZONE;
});

describe('GET /api/admin/ads/keywords', () => {
  it('401 signed out, 403 non-admin', async () => {
    expect((await keywords(req('/api/admin/ads/keywords'))).status).toBe(401);
    expect((await keywords(req('/api/admin/ads/keywords', USER))).status).toBe(403);
  });

  it('400 on a bad channel / level, and on keyword level for Google Ads (no keyword attribution)', async () => {
    expect((await keywords(req('/api/admin/ads/keywords?channel=tiktok', ADMIN))).status).toBe(400);
    expect((await keywords(req('/api/admin/ads/keywords?level=ad', ADMIN))).status).toBe(400);
    const g = await keywords(req('/api/admin/ads/keywords?channel=google_ads&level=keyword', ADMIN));
    expect(g.status).toBe(400);
    expect((await g.json()).error.message).toMatch(/level=ad_group/);
    expect((await keywords(req('/api/admin/ads/keywords?channel=google_ads', ADMIN))).status).toBe(200);
  });

  it('Apple keywords: per-keyword funnel, unattributed row, reconciles with the overview by campaign', async () => {
    const res = await keywords(req('/api/admin/ads/keywords', ADMIN));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(['channel', 'definitions', 'excludedUsers', 'lastSync', 'level', 'levels', 'minSignUps', 'range', 'reconciliation', 'rows', 'totals', 'unknownEntitySignUps']);
    expect(data).toMatchObject({ channel: 'apple_ads', level: 'keyword', levels: ['keyword', 'ad_group'], minSignUps: 10 });
    const by = Object.fromEntries(data.rows.map((r: any) => [r.key, r.metrics]));
    expect(by['apple_ads:keyword:K1']).toMatchObject({ spend: 20, taps: 8, installs: 3, signUps: 1, paywall: 1, trials: 1, payers: 1, revenue: 8.49, costPerSignUp: 20, costPerTrial: 20, costPerPayer: 20, lowSample: true, flag: null });
    expect(by['apple_ads:keyword:K2']).toMatchObject({ spend: 4, signUps: 1, paywall: 0, trials: 0, flag: 'no_trials' });
    expect(by['apple_ads:none']).toMatchObject({ spend: 6, taps: 2, installs: 1, signUps: 1, paywall: 1, trials: 0 });
    expect(data.reconciliation.every((r: any) => r.ok)).toBe(true);
    expect(data.definitions.costPerTrial).toBeTruthy();

    const ov = (await (await overview(req('/api/admin/ads/overview?groupBy=campaign', ADMIN))).json()).data;
    const camp = ov.rows.find((r: any) => r.key === 'apple_ads:campaign:C1').metrics;
    expect(data.totals.metrics).toMatchObject({ spend: camp.spend, taps: camp.taps, installs: camp.installs, signUps: camp.users, trials: camp.trials, payers: camp.payers, revenue: camp.revenueToDate });
  });

  it('Apple by ad group', async () => {
    const { data } = await (await keywords(req('/api/admin/ads/keywords?level=ad_group', ADMIN))).json();
    expect(data.rows.map((r: any) => [r.key, r.metrics.spend, r.metrics.signUps, r.metrics.paywall])).toEqual([['apple_ads:ad_group:G1', 30, 3, 2]]);
  });
});

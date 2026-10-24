import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer user:')) throw new Error('Unauthorized');
    return { id: auth.slice('Bearer user:'.length) };
  },
}));

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { attributionFromRevenueCat, classifyChannel } from '@/lib/ads/attribution';
import { AdsAttributionService } from '@/lib/ads/services/attribution-service';

import { POST } from '../route';

const U = '11111111-2222-4333-8444-555555555555';
let db: AdsFakeDb;

const post = (body: unknown, as: string | null = U) =>
  POST(
    new NextRequest('https://www.fitcircle.ai/api/mobile/attribution', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(as ? { authorization: `Bearer user:${as}` } : {}) },
      body: JSON.stringify(body),
    })
  );

const ASA = { platform: 'ios', source: 'apple_search_ads', campaignId: 2144950391, adGroupId: '2152121621', keywordId: '2360029480', adId: null, clickDate: '2026-10-24T11:02:00Z', country: 'us', raw: { attribution: true, orgId: 25006540 } };

beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
});

describe('POST /api/mobile/attribution', () => {
  it('401 without auth, 400 on a bad body', async () => {
    expect((await post(ASA, null)).status).toBe(401);
    const bad = await post({ platform: 'web', source: '' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('stores an Apple Ads touch (ids as strings, country upper-cased)', async () => {
    const res = await post(ASA);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      channel: 'apple_ads',
      platform: 'ios',
      source: 'apple_search_ads',
      campaignId: '2144950391',
      adGroupId: '2152121621',
      keywordId: '2360029480',
      adId: null,
      isTest: false,
      created: true,
      updated: false,
    });
    expect(db.rows('user_attribution')[0]).toMatchObject({ user_id: U, country: 'US', click_at: '2026-10-24T11:02:00.000Z' });
  });

  it('first touch wins (idempotent)', async () => {
    await post(ASA);
    const second = await (await post({ platform: 'ios', source: 'meta', campaignId: '999' })).json();
    expect(second.data).toMatchObject({ channel: 'apple_ads', campaignId: '2144950391', created: false, updated: false });
    expect(db.rows('user_attribution')).toHaveLength(1);
  });

  it('Apple mock payload (campaign 1234567890) → is_test', async () => {
    const { data } = await (await post({ ...ASA, campaignId: '1234567890' })).json();
    expect(data).toMatchObject({ channel: 'apple_ads', isTest: true });
  });

  it('unknown is upgraded once by a known channel', async () => {
    const first = await (await post({ platform: 'android', source: 'something-new' })).json();
    expect(first.data).toMatchObject({ channel: 'unknown', created: true });
    const up = await (await post({ platform: 'android', source: 'google-play', raw: { utm_source: 'meta', utm_campaign: 'x' }, campaignId: '120200000000000001' })).json();
    expect(up.data).toMatchObject({ channel: 'meta', campaignId: '120200000000000001', updated: true });
    const again = await (await post({ platform: 'android', source: 'google-play' })).json();
    expect(again.data).toMatchObject({ channel: 'meta', updated: false });
  });

  it('organic installs drop campaign ids', async () => {
    const { data } = await (await post({ platform: 'ios', source: 'apple_search_ads', campaignId: null, raw: { attribution: false } })).json();
    expect(data).toMatchObject({ channel: 'organic', campaignId: null });
  });
});

describe('classifyChannel', () => {
  it('maps sources', () => {
    expect(classifyChannel('google-play', { referrer: 'utm_source=google-play&utm_medium=organic' })).toBe('organic');
    expect(classifyChannel('google-play', { referrer: 'utm_source=facebook&utm_campaign=c' })).toBe('meta');
    expect(classifyChannel('google-play', { fbclid: 'abc' })).toBe('meta');
    expect(classifyChannel('instagram')).toBe('meta');
    expect(classifyChannel('google-play', { gclid: 'x' })).toBe('google_ads');
    expect(classifyChannel('organic')).toBe('organic');
    expect(classifyChannel('Apple Search Ads', null, '2144950391')).toBe('apple_ads');
    expect(classifyChannel('tiktok')).toBe('unknown');
  });
});

describe('RevenueCat fallback', () => {
  const rc = (over: Record<string, unknown> = {}) => ({
    id: 'evt',
    type: 'INITIAL_PURCHASE',
    app_user_id: U,
    environment: 'PRODUCTION',
    store: 'APP_STORE',
    subscriber_attributes: {
      $mediaSource: { value: 'Apple Search Ads', updated_at_ms: 1 },
      $campaign: { value: '2144950391', updated_at_ms: 1 },
      $adGroup: { value: '2152121621', updated_at_ms: 1 },
      $keyword: { value: '2360029480', updated_at_ms: 1 },
    },
    ...over,
  });

  it('maps subscriber_attributes', () => {
    expect(attributionFromRevenueCat(rc())).toMatchObject({ channel: 'apple_ads', platform: 'ios', source: 'revenuecat', campaign_external_id: '2144950391', ad_group_external_id: '2152121621', keyword_external_id: '2360029480' });
    expect(attributionFromRevenueCat(rc({ subscriber_attributes: {} }))).toBeNull();
  });

  it('inserts only when no row exists; sandbox / non-purchase skipped; never throws', async () => {
    expect(await AdsAttributionService.fromRevenueCat(rc({ environment: 'SANDBOX' }))).toBe('skipped');
    expect(await AdsAttributionService.fromRevenueCat(rc({ type: 'EXPIRATION' }))).toBe('skipped');
    expect(await AdsAttributionService.fromRevenueCat(rc())).toBe('inserted');
    expect(await AdsAttributionService.fromRevenueCat(rc({ subscriber_attributes: { $mediaSource: { value: 'Facebook Ads' } } }))).toBe('exists');
    expect(db.rows('user_attribution')).toHaveLength(1);
    db.failing.add('user_attribution');
    expect(await AdsAttributionService.fromRevenueCat(rc({ app_user_id: '99999999-2222-4333-8444-555555555555' }))).toBe('error');
  });
});

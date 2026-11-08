/**
 * GET /api/admin/subscriptions/trials[/:userId]: auth gate, envelope, default
 * view (production + real users only), toggles, detail.
 */
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

import { GET as detail } from '../[userId]/route';
import { GET as list } from '../route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IOS = 'b568683c-b221-43d3-8134-48cae4aee9e4';
const PLAY = '4f3fc326-4188-4b3e-b53c-2793b775cfed';
const OWNER_ALIAS = '2f18724e-4b03-4c96-a72c-359e72e62d38';
const SANDBOX_REAL = '33333333-3333-4333-8333-333333333333';
const PROMO = '44444444-4444-4444-8444-444444444444';
const SECRET = 'Bearer shh';

let db: AdsFakeDb;

const req = (url: string, auth?: string) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, { headers: auth ? { authorization: auth, 'x-admin-actor': 'ani@inov8rlabs.com' } : {} });
const params = (userId: string) => ({ params: Promise.resolve({ userId }) });

const recent = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const prof = (id: string, p: Record<string, any>) => ({
  id,
  email: `${id.slice(0, 4)}@yahoo.com`,
  email_canonical: `${id.slice(0, 4)}@yahoo.com`,
  display_name: id.slice(0, 4),
  username: null,
  created_at: recent(30),
  is_admin: false,
  metadata: {},
  country_code: null,
  subscription_tier: 'premium',
  subscription_status: 'trialing',
  subscription_platform: 'app_store',
  subscription_product_id: 'com.inov8rlabs.fitcircle.pro.monthly',
  subscription_expires_at: ahead(48),
  subscription_will_renew: true,
  trial_started_at: recent(24),
  trial_ends_at: ahead(48),
  trial_converted_at: null,
  last_active_at: recent(1),
  onboarding_completed: true,
  onboarding_completed_at: recent(29),
  onboarding_flow: 'v3',
  timezone: 'America/New_York',
  ...p,
});

const trialEvent = (id: string, userId: string, store: string, environment: string, extra: Record<string, any> = {}) => ({
  id,
  user_id: userId,
  type: 'INITIAL_PURCHASE',
  store,
  environment,
  event_timestamp: recent(24),
  raw: { period_type: 'TRIAL', price: 0, currency: 'USD', country_code: 'US', store, product_id: 'com.inov8rlabs.fitcircle.pro.monthly', ...extra },
});

beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
  process.env.ADMIN_API_SECRET = 'shh';
  db.tables.profiles = [
    { ...prof(ADMIN, { subscription_platform: null, subscription_status: null, trial_started_at: null, trial_ends_at: null }), is_admin: true, email: 'owner@gmail.com', email_canonical: 'owner@gmail.com' },
    prof(IOS, {}),
    prof(PLAY, { subscription_platform: 'play_store', subscription_product_id: 'com.inov8rlabs.fitcircle.pro.annual:annual' }),
    prof(OWNER_ALIAS, { email: 'owner+play@gmail.com', email_canonical: 'owner@gmail.com', subscription_platform: 'play_store' }),
    prof(SANDBOX_REAL, {}),
    prof(PROMO, { subscription_platform: 'promotional', subscription_product_id: 'complimentary' }),
  ];
  db.tables.subscription_events = [
    trialEvent('e1', IOS, 'APP_STORE', 'PRODUCTION'),
    trialEvent('e2', PLAY, 'PLAY_STORE', 'PRODUCTION', { product_id: 'com.inov8rlabs.fitcircle.pro.annual:annual', offer_code: 'annual-trial3d' }),
    trialEvent('e3', OWNER_ALIAS, 'PLAY_STORE', 'PRODUCTION'),
    trialEvent('e4', SANDBOX_REAL, 'APP_STORE', 'SANDBOX'),
  ];
  db.tables.user_attribution = [
    { user_id: IOS, channel: 'organic', platform: 'ios', source: 'organic', campaign_external_id: null, ad_group_external_id: null, keyword_external_id: null, ad_external_id: null, click_at: null, country: null, is_test: false, raw: { attribution: false }, reported_at: recent(25) },
    { user_id: PLAY, channel: 'google_ads', platform: 'android', source: 'google_ads', campaign_external_id: 'C9', ad_group_external_id: null, keyword_external_id: null, ad_external_id: null, click_at: null, country: null, is_test: false, raw: { has_gclid: true }, reported_at: recent(25) },
  ];
  db.tables.ad_entities = [{ id: 'x1', channel: 'google_ads', level: 'campaign', external_id: 'C9', name: 'Android installs US' }];
  db.tables.experiments = [
    { key: 'onboarding_paywall', name: 'Onboarding paywall', arms: [{ key: 'control', name: 'Plans' }, { key: 'variantB', name: 'Annual with savings' }] },
  ];
  db.tables.experiment_assignments = [
    { experiment_key: 'onboarding_paywall', user_id: IOS, arm: 'control', assigned_at: recent(25), first_exposed_at: recent(24), exposure_surface: 'onboarding_paywall', platform: 'ios', app_version: '1.1.2', country: 'US', reason: 'bucket' },
    { experiment_key: 'onboarding_paywall', user_id: PLAY, arm: 'variantB', assigned_at: recent(25), first_exposed_at: recent(24), exposure_surface: 'v3_welcome', platform: 'android', app_version: '1.1.2', country: 'VI', reason: 'bucket' },
  ];
  db.tables.food_log_entries = [
    { id: 'f1', user_id: IOS, entry_type: 'food', logged_at: recent(20), deleted_at: null },
    { id: 'f2', user_id: IOS, entry_type: 'food', logged_at: recent(10), deleted_at: null },
    { id: 'f3', user_id: IOS, entry_type: 'water', logged_at: recent(10), deleted_at: null },
    { id: 'f4', user_id: IOS, entry_type: 'food', logged_at: recent(5), deleted_at: recent(4) },
  ];
  db.tables.fitzy_messages = [
    { id: 'm1', user_id: IOS, role: 'user' },
    { id: 'm2', user_id: IOS, role: 'assistant' },
  ];
});

afterEach(() => {
  delete process.env.ADMIN_API_SECRET;
});

describe('auth', () => {
  it('401 without credentials', async () => {
    const res = await list(req('/api/admin/subscriptions/trials'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('401 with a wrong secret', async () => {
    expect((await list(req('/api/admin/subscriptions/trials', 'Bearer nope'))).status).toBe(401);
    expect((await detail(req(`/api/admin/subscriptions/trials/${IOS}`, 'Bearer nope'), params(IOS))).status).toBe(401);
  });
  it('403 for a signed-in non-admin', async () => {
    expect((await list(req('/api/admin/subscriptions/trials', `Bearer user:${IOS}`))).status).toBe(403);
  });
  it('200 for an admin session and for the API secret', async () => {
    expect((await list(req('/api/admin/subscriptions/trials', `Bearer user:${ADMIN}`))).status).toBe(200);
    const res = await list(req('/api/admin/subscriptions/trials', SECRET));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('list', () => {
  it('default view = real production trials only, with hidden counts', async () => {
    const body = await (await list(req('/api/admin/subscriptions/trials', SECRET))).json();
    expect(body.success).toBe(true);
    const d = body.data;
    expect(d.trials.map((t: any) => t.userId).sort()).toEqual([IOS, PLAY].sort());
    expect(d.hidden).toEqual({ sandbox: 1, test: 1 });
    expect(d.summary).toMatchObject({ total: 2, activeNow: 2, trialing: 2, converted: 0, conversionRate: null });
    const play = d.trials.find((t: any) => t.userId === PLAY);
    expect(play).toMatchObject({
      platform: 'play_store',
      plan: 'annual',
      environment: 'production',
      status: 'trialing',
      channel: 'google_ads',
      campaignName: 'Android installs US',
      country: 'US',
      countrySource: 'store',
      arms: [{ experimentKey: 'onboarding_paywall', arm: 'variantB', armName: 'Annual with savings' }],
      isTest: false,
    });
    expect(d.byPlatform.map((r: any) => r.key).sort()).toEqual(['app_store', 'play_store']);
    expect(d.byChannel.map((r: any) => r.key).sort()).toEqual(['google_ads', 'organic']);
    expect(d.byArm.map((r: any) => r.key).sort()).toEqual(['onboarding_paywall:control', 'onboarding_paywall:variantB']);
  });

  it('promotional grants never appear', async () => {
    const d = (await (await list(req('/api/admin/subscriptions/trials?includeSandbox=1&includeTest=1', SECRET))).json()).data;
    expect(d.trials.map((t: any) => t.userId)).not.toContain(PROMO);
    expect(d.trials).toHaveLength(4);
  });

  it('includeTest brings back owner aliases, flagged', async () => {
    const d = (await (await list(req('/api/admin/subscriptions/trials?includeTest=1', SECRET))).json()).data;
    const alias = d.trials.find((t: any) => t.userId === OWNER_ALIAS);
    expect(alias).toMatchObject({ isTest: true, testReasons: ['admin_alias'] });
    expect(d.trials.map((t: any) => t.userId)).not.toContain(SANDBOX_REAL);
  });

  it('includeSandbox brings back sandbox trials', async () => {
    const d = (await (await list(req('/api/admin/subscriptions/trials?includeSandbox=true', SECRET))).json()).data;
    expect(d.trials.find((t: any) => t.userId === SANDBOX_REAL)).toMatchObject({ environment: 'sandbox' });
  });

  it('platform + range filters', async () => {
    const d = (await (await list(req('/api/admin/subscriptions/trials?platform=app_store', SECRET))).json()).data;
    expect(d.trials.map((t: any) => t.userId)).toEqual([IOS]);
    db.rows('profiles').find((p) => p.id === IOS)!.trial_started_at = recent(24 * 20);
    db.rows('subscription_events').find((e) => e.id === 'e1')!.event_timestamp = recent(24 * 20);
    const week = (await (await list(req('/api/admin/subscriptions/trials?range=7d', SECRET))).json()).data;
    expect(week.trials.map((t: any) => t.userId)).toEqual([PLAY]);
  });
});

describe('detail', () => {
  it('400 for a non-UUID id, 404 for unknown users and non-trials', async () => {
    expect((await detail(req('/api/admin/subscriptions/trials/nope', SECRET), params('nope'))).status).toBe(400);
    const unknown = '99999999-9999-4999-8999-999999999999';
    expect((await detail(req(`/api/admin/subscriptions/trials/${unknown}`, SECRET), params(unknown))).status).toBe(404);
    const promo = await (await detail(req(`/api/admin/subscriptions/trials/${PROMO}`, SECRET), params(PROMO))).json();
    expect(promo.error.code).toBe('NOT_A_TRIAL');
  });

  it('returns profile, location signals, UA, subscription, events, experiments, engagement, flags', async () => {
    const res = await detail(req(`/api/admin/subscriptions/trials/${IOS}`, SECRET), params(IOS));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const d = (await res.json()).data;
    expect(d.trial).toMatchObject({ userId: IOS, platform: 'app_store', status: 'trialing', environment: 'production' });
    expect(d.profile).toMatchObject({ appPlatform: 'ios', appVersion: '1.1.2', timezone: 'America/New_York', onboardingCompleted: true });
    expect(d.location.signals.map((s: any) => s.source)).toEqual(['store', 'experiment_assignment', 'timezone']);
    expect(d.acquisition).toMatchObject({ channel: 'organic', source: 'organic', rawKeys: ['attribution'] });
    expect(d.subscription).toMatchObject({ store: 'APP_STORE', currency: 'USD', storeCountry: 'US', willRenew: true, lastCharge: null });
    expect(d.events).toHaveLength(1);
    expect(d.experiments[0]).toMatchObject({ experimentKey: 'onboarding_paywall', experimentName: 'Onboarding paywall', arm: 'control', armName: 'Plans' });
    expect(d.engagement).toMatchObject({ mealsLogged: 2, foodLogEntries: 3, fitzyMessages: 1, checkIns: 0, circlesJoined: 0 });
    expect(d.flags).toMatchObject({ isTest: false, test: [], environment: 'production', productionEvents: 1, sandboxEvents: 0 });
  });

  it('flags an owner alias in the detail', async () => {
    const d = (await (await detail(req(`/api/admin/subscriptions/trials/${OWNER_ALIAS}`, SECRET), params(OWNER_ALIAS))).json()).data;
    expect(d.flags.isTest).toBe(true);
    expect(d.flags.test[0].reason).toBe('admin_alias');
  });
});

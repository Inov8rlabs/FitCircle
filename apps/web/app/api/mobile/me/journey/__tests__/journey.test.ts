/**
 * GET/PATCH /api/mobile/me/journey + POST /events (ACTIVATION_JOURNEY_SPEC
 * Appendix A), paywall moments (§5), fitzy_opened_at + promo conversions (§6).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ subs: true }));

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getHomeFeedDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});
vi.mock('@/lib/services/entitlement-service', () => ({
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
  EntitlementService: { areSubscriptionsEnabled: async () => h.subs },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { paywallEligibility } from '@/lib/journey/paywall';
import { JourneyService } from '@/lib/services/journey-service';
import { PromoService, applyPromoEvents, convertsNow } from '@/lib/services/promo-service';

import { POST as postEvent } from '../events/route';
import { GET, PATCH } from '../route';

const U = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-10-26T18:00:00Z');
let db: HomeFeedFakeDb;

const get = () => GET(new NextRequest('https://www.fitcircle.ai/api/mobile/me/journey', { headers: { authorization: `Bearer user:${U}` } }));
const send = (method: 'PATCH' | 'POST', path: string, body: unknown, fn: (r: NextRequest) => Promise<Response>) =>
  fn(new NextRequest(`https://www.fitcircle.ai${path}`, { method, headers: { authorization: `Bearer user:${U}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  h.subs = true;
  db.rows('profiles').push({
    id: U,
    created_at: '2026-10-26T17:55:00Z',
    subscription_tier: 'free',
    preferences: { hydration: { goal_ml: 2000 } },
    fitzy_opened_at: null,
    fitzy_intro_seen_at: null,
    paywall_auto_last_at: null,
    paywall_aha_shown_at: null,
  });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.PROMOS_ENABLED;
});

describe('GET /api/mobile/me/journey', () => {
  it('new user, no meals: nothing auto, post-aha allowed, default meal prefs', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      mealsLoggedEver: 0,
      firstMealAt: null,
      fitzyOpenedAt: null,
      fitzyIntroSeenAt: null,
      paywallAutoEligible: false,
      autoEligible: false,
      postAhaEligible: true,
      nextAutoEligibleAt: null,
      isPro: false,
      subscriptionsEnabled: true,
      signupAt: '2026-10-26T17:55:00Z',
      mealReminderPrefs: { breakfast: true, lunch: true, snack: false, dinner: true },
    });
  });

  it('counts food meals only and reports the first meal', async () => {
    db.rows('food_log_entries').push(
      { id: 'a', user_id: U, entry_type: 'food', created_at: '2026-10-26T17:58:00Z', deleted_at: null },
      { id: 'b', user_id: U, entry_type: 'food', created_at: '2026-10-26T17:59:00Z', deleted_at: null },
      { id: 'c', user_id: U, entry_type: 'water', created_at: '2026-10-26T17:57:00Z', deleted_at: null },
      { id: 'd', user_id: U, entry_type: 'food', created_at: '2026-10-26T17:56:00Z', deleted_at: '2026-10-26T17:57:00Z' }
    );
    const { data } = await (await get()).json();
    expect(data.mealsLoggedEver).toBe(2);
    expect(data.firstMealAt).toBe('2026-10-26T17:58:00Z');
    expect(data.paywallAutoEligible).toBe(false); // signed up 5 min ago (< 10 min)
    vi.setSystemTime(new Date('2026-10-26T18:10:00Z'));
    expect((await (await get()).json()).data.paywallAutoEligible).toBe(true);
  });
});

describe('paywall moments (pure)', () => {
  const base = { isPro: false, subscriptionsEnabled: true, mealsLoggedEver: 1, signupAt: '2026-10-20T00:00:00Z', autoLastAt: null, ahaShownAt: null, now: NOW };
  it('auto: value first, not in the first 10 min, at most once per 72 h', () => {
    expect(paywallEligibility(base).autoEligible).toBe(true);
    expect(paywallEligibility({ ...base, mealsLoggedEver: 0 }).autoEligible).toBe(false);
    expect(paywallEligibility({ ...base, signupAt: '2026-10-26T17:52:00Z' }).autoEligible).toBe(false);
    const recent = paywallEligibility({ ...base, autoLastAt: '2026-10-25T18:00:00Z' });
    expect(recent).toMatchObject({ autoEligible: false, postAhaEligible: false, nextAutoEligibleAt: '2026-10-28T18:00:00.000Z' });
    expect(paywallEligibility({ ...base, autoLastAt: '2026-10-23T17:59:00Z' }).autoEligible).toBe(true);
  });
  it('post-aha: once ever, exempt from the 10-minute rule; never for Pro or with subscriptions off', () => {
    expect(paywallEligibility({ ...base, signupAt: NOW.toISOString(), mealsLoggedEver: 0 }).postAhaEligible).toBe(true);
    expect(paywallEligibility({ ...base, ahaShownAt: '2026-10-21T00:00:00Z' }).postAhaEligible).toBe(false);
    expect(paywallEligibility({ ...base, isPro: true })).toMatchObject({ autoEligible: false, postAhaEligible: false });
    expect(paywallEligibility({ ...base, subscriptionsEnabled: false })).toMatchObject({ autoEligible: false, postAhaEligible: false });
  });
});

describe('PATCH /api/mobile/me/journey (meal reminder prefs)', () => {
  it('merges slot toggles into profiles.preferences without touching other keys', async () => {
    const res = await send('PATCH', '/api/mobile/me/journey', { mealReminderPrefs: { snack: true, breakfast: false } }, PATCH);
    expect(res.status).toBe(200);
    expect((await res.json()).data.mealReminderPrefs).toEqual({ breakfast: false, lunch: true, snack: true, dinner: true });
    expect(db.rows('profiles')[0].preferences).toEqual({ hydration: { goal_ml: 2000 }, notifications: { meal_reminders: { snack: true, breakfast: false } } });
  });
  it('400 on unknown slots / non-booleans', async () => {
    expect((await send('PATCH', '/api/mobile/me/journey', { mealReminderPrefs: { brunch: true } }, PATCH)).status).toBe(400);
    expect((await send('PATCH', '/api/mobile/me/journey', { mealReminderPrefs: { lunch: 'yes' } }, PATCH)).status).toBe(400);
  });
});

describe('POST /api/mobile/me/journey/events', () => {
  it('fitzy_opened sets fitzy_opened_at once', async () => {
    const res = await send('POST', '/api/mobile/me/journey/events', { event: 'fitzy_opened' }, postEvent);
    expect(res.status).toBe(200);
    expect(db.rows('profiles')[0].fitzy_opened_at).toBe(NOW.toISOString());
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await send('POST', '/api/mobile/me/journey/events', { event: 'fitzy_opened' }, postEvent);
    expect(db.rows('profiles')[0].fitzy_opened_at).toBe(NOW.toISOString());
  });
  it('fitzy_intro_seen and paywall_shown (aha = once; automatic starts the 72 h spacing; a tap does not)', async () => {
    await send('POST', '/api/mobile/me/journey/events', { event: 'fitzy_intro_seen' }, postEvent);
    expect(db.rows('profiles')[0].fitzy_intro_seen_at).toBe(NOW.toISOString());
    await send('POST', '/api/mobile/me/journey/events', { event: 'paywall_shown', placement: 'feed_pro_value', automatic: false }, postEvent);
    expect(db.rows('profiles')[0].paywall_auto_last_at).toBeNull();
    const res = await send('POST', '/api/mobile/me/journey/events', { event: 'paywall_shown', placement: 'first_meal_aha' }, postEvent);
    expect((await res.json()).data).toMatchObject({ event: 'paywall_shown', paywallAutoLastAt: NOW.toISOString(), paywallAhaShownAt: NOW.toISOString() });
    const { data } = await (await get()).json();
    expect(data).toMatchObject({ postAhaEligible: false, autoEligible: false });
  });
  it('400 on unknown events', async () => {
    expect((await send('POST', '/api/mobile/me/journey/events', { event: 'paywall_purchased' }, postEvent)).status).toBe(400);
  });
});

describe('markFitzyOpened + promo conversions', () => {
  it('zero writes once set, or when the 110 column is absent from the auth profile', async () => {
    const before = db.queries.profiles ?? 0;
    expect(await JourneyService.markFitzyOpened(U, { id: U, fitzy_opened_at: '2026-10-01T00:00:00Z' })).toBe(false);
    expect(await JourneyService.markFitzyOpened(U, { id: U })).toBe(false);
    expect(db.queries.profiles ?? 0).toBe(before);
  });

  it('first open converts a tapped meet_fitzy promo (within 7 days) when promos are on', async () => {
    process.env.PROMOS_ENABLED = 'true';
    db.rows('promo_user_state').push({ user_id: U, promo_key: 'meet_fitzy', creative_id: 'meet_fitzy_v1', tapped_at: '2026-10-25T18:00:00Z', converted_at: null });
    expect(await JourneyService.markFitzyOpened(U, { id: U, fitzy_opened_at: null }, NOW)).toBe(true);
    expect(db.rows('promo_user_state')[0].converted_at).toBe(NOW.toISOString());
  });

  it('conversion rules: tap required, 7-day window, once; no-op while promos are off', async () => {
    expect(convertsNow({ tapped_at: '2026-10-20T18:00:00Z', converted_at: null }, NOW)).toBe(true);
    expect(convertsNow({ tapped_at: '2026-10-19T17:00:00Z', converted_at: null }, NOW)).toBe(false);
    expect(convertsNow({ tapped_at: null, converted_at: null }, NOW)).toBe(false);
    expect(convertsNow({ tapped_at: '2026-10-25T18:00:00Z', converted_at: '2026-10-25T19:00:00Z' }, NOW)).toBe(false);
    db.rows('promo_user_state').push({ user_id: U, promo_key: 'pro_value', creative_id: 'pro_value_coach', tapped_at: '2026-10-25T18:00:00Z', converted_at: null });
    expect(await PromoService.recordConversion(U, 'subscription_started', NOW)).toEqual([]);
    process.env.PROMOS_ENABLED = 'true';
    expect(await PromoService.recordConversion(U, 'subscription_started', NOW)).toEqual(['pro_value']);
  });

  it('applyPromoEvents folds impressions per local day and keeps 14 seen days', () => {
    let row = applyPromoEvents(null, U, 'pro_value', [{ card_id: 'promo:pro_value', event: 'impression', creative_id: 'pro_value_coach', occurredAt: null }], '2026-10-26', NOW.toISOString());
    row = applyPromoEvents(row, U, 'pro_value', [{ card_id: 'promo:pro_value', event: 'impression', occurredAt: null }, { card_id: 'promo:pro_value', event: 'cta', button: 'primary', occurredAt: null }], '2026-10-26', NOW.toISOString());
    expect(row).toMatchObject({ impressions_total: 2, impressions_day: 2, day: '2026-10-26', seen_days: ['2026-10-26'], tapped_button: 'primary', creative_id: 'pro_value_coach' });
    row = applyPromoEvents(row, U, 'pro_value', [{ card_id: 'promo:pro_value', event: 'impression', occurredAt: null }], '2026-10-27', NOW.toISOString());
    expect(row).toMatchObject({ impressions_total: 3, impressions_day: 1, day: '2026-10-27', seen_days: ['2026-10-27', '2026-10-26'] });
  });
});

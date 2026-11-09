/**
 * Unlock audit (docs/TRIAL_FIRST_SPEC.md §4): a store or web trial start makes the user Pro
 * IMMEDIATELY on every server surface, and expiry without conversion re-locks.
 *
 * Path under test: RevenueCat webhook event → SubscriptionService.processRevenueCatEvent →
 * profiles.subscription_tier → (EntitlementService | UsageService) reads. The Stripe web trial
 * reaches the same path: /api/webhooks/stripe forwards the receipt to RevenueCat, which emits
 * INITIAL_PURCHASE with store STRIPE + period_type TRIAL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDb, getDb, setDb } from './fake-supabase-admin';

vi.mock('../../supabase-admin', async () => {
  const { getDb } = await import('./fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});
vi.mock('../promo-service', () => ({ PromoService: { recordConversion: async () => [] } }));
vi.mock('../complimentary-grant-service', () => ({ ComplimentaryGrantService: { holdIfGranted: async () => false } }));

import { resetRemoteConfigCache } from '../../remote-config/service';
import { ALL_FEATURE_KEYS } from '../../types/body-composition';
import { EntitlementService } from '../entitlement-service';
import { SubscriptionService, type RevenueCatEvent } from '../subscription-service';
import { UpgradeRequiredError, UsageService } from '../usage-service';

const USER = '11111111-2222-3333-4444-555555555555';
const T0 = Date.UTC(2026, 10, 6, 14, 0, 0);
const DAY = 86_400_000;
let seq = 0;
const ev = (o: Partial<RevenueCatEvent>): RevenueCatEvent => {
  seq++;
  return {
    id: `evt_${seq}`,
    type: 'INITIAL_PURCHASE',
    app_user_id: USER,
    product_id: 'com.inov8rlabs.fitcircle.pro.annual',
    period_type: 'TRIAL',
    event_timestamp_ms: T0 + seq * 1000,
    purchased_at_ms: T0,
    expiration_at_ms: T0 + 3 * DAY,
    store: 'APP_STORE',
    environment: 'PRODUCTION',
    price: 0,
    currency: 'USD',
    ...o,
  };
};

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, {
    id: USER,
    subscription_tier: 'free',
    subscription_status: null,
    subscription_platform: null,
    subscription_synced_at: null,
    trial_started_at: null,
    trial_ends_at: null,
    trial_converted_at: null,
    created_at: '2026-10-01T00:00:00Z',
  });
  // Every gate live (prod state, 2026-11-06), except body_comp_logging which is free in prod.
  for (const key of ALL_FEATURE_KEYS) db.feature_gates.set(key, key === 'body_comp_logging' ? 'free' : 'premium');
  setDb(db);
  resetRemoteConfigCache();
  seq = 0;
});

async function expectLocked() {
  const e = await EntitlementService.getEntitlements(USER);
  expect(e.tier).toBe('free');
  expect(e.features.ads_removed.allowed).toBe(false);
  expect(e.features.fitzy_unlimited.allowed).toBe(false);
  expect(e.limits?.fitzyMessagesPerDay).toBe(0);
  await expect(UsageService.assertFitzyQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);
  expect(await UsageService.fitzyTier(USER)).toBe('free'); // plan / memory / history locked
  expect(await UsageService.historyWindowDays(USER)).toBe(14);
  expect(await UsageService.checkCircleCreation(USER)).toBeNull(); // no circles yet
}

async function expectUnlocked() {
  const e = await EntitlementService.getEntitlements(USER);
  expect(e.tier).toBe('premium');
  for (const [key, f] of Object.entries(e.features)) expect({ key, allowed: f.allowed }).toEqual({ key, allowed: true });
  expect(e.features.ads_removed.allowed).toBe(true); // ads removed
  expect(e.limits).toMatchObject({ fitzyMessagesPerDay: 200, foodAiParsesPerDay: 100, foodAiAnalysesTotal: null, foodAiAnalysesRemaining: null, historyDays: null, maxActiveCreatedCircles: null });
  await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined(); // Fitzy quota lifts
  await expect(UsageService.assertFoodAiQuota(USER)).resolves.toBeUndefined();
  expect(await UsageService.fitzyTier(USER)).toBe('pro'); // weekly plan, memory, history
  expect(await UsageService.historyWindowDays(USER)).toBe(Number.POSITIVE_INFINITY);
  for (const key of ALL_FEATURE_KEYS) expect(await EntitlementService.isFeatureAllowed(USER, key)).toBe(true);
  return e;
}

describe.each([
  ['App Store', 'APP_STORE', 'app_store'],
  ['Play', 'PLAY_STORE', 'play_store'],
  ['Stripe (web, via RevenueCat)', 'STRIPE', 'stripe'],
])('%s trial', (_label, store, platform) => {
  it('INITIAL_PURCHASE period_type TRIAL → premium immediately; every Pro surface unlocks; isTrial reported', async () => {
    await expectLocked();
    // Free food allowance already used up before the trial: the trial lifts it.
    for (let i = 0; i < 5; i++) getDb().nutrition_parse_log.push({ id: `p${i}`, user_id: USER, created_at: '2026-10-05T00:00:00Z' });

    expect(await SubscriptionService.processRevenueCatEvent(ev({ store }))).toBe('applied');
    expect(getDb().profiles.get(USER)).toMatchObject({ subscription_tier: 'premium', subscription_status: 'trialing', subscription_platform: platform });

    const e = await expectUnlocked();
    expect(e.subscription).toMatchObject({ isTrial: true, platform });
  });

  it('cancel during the trial keeps Pro until EXPIRATION; EXPIRATION re-locks (and the food allowance counts again)', async () => {
    await SubscriptionService.processRevenueCatEvent(ev({ store }));
    await SubscriptionService.processRevenueCatEvent(ev({ store, type: 'CANCELLATION', cancel_reason: 'UNSUBSCRIBE' } as any));
    expect(getDb().profiles.get(USER)).toMatchObject({ subscription_tier: 'premium', subscription_will_renew: false });
    await expectUnlocked();

    for (let i = 0; i < 7; i++) getDb().nutrition_parse_log.push({ id: `t${i}`, user_id: USER, created_at: '2026-11-07T00:00:00Z' }); // used during the trial
    await SubscriptionService.processRevenueCatEvent(ev({ store, type: 'EXPIRATION' }));
    expect(getDb().profiles.get(USER)).toMatchObject({ subscription_tier: 'free', subscription_status: 'cancelled' });
    await expectLocked();
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);
    // Trial used → paywall copy switches to the non-trial version.
    const err = await UsageService.assertFitzyQuota(USER).catch((x) => x);
    expect(err.trialEligible).toBe(false);
  });
});

it('trial conversion (RENEWAL) keeps everything unlocked as active', async () => {
  await SubscriptionService.processRevenueCatEvent(ev({}));
  await SubscriptionService.processRevenueCatEvent(ev({ type: 'RENEWAL', period_type: 'NORMAL', is_trial_conversion: true, price: 29.99 } as any));
  expect(getDb().profiles.get(USER)).toMatchObject({ subscription_tier: 'premium', subscription_status: 'active' });
  const e = await expectUnlocked();
  expect(e.subscription?.isTrial).toBe(false);
});

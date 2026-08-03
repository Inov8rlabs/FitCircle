import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDb, getDb, setDb } from './fake-supabase-admin';

vi.mock('../../supabase-admin', async () => {
  const { getDb } = await import('./fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});

import { UsageService, UpgradeRequiredError } from '../usage-service';
import { EntitlementService } from '../entitlement-service';
import { LEGACY_LIMITS, TIER_LIMITS } from '../../config/tier-limits';

const USER = '11111111-2222-3333-4444-555555555555';

function seedParses(n: number) {
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    getDb().nutrition_parse_log.push({ user_id: USER, created_at: now });
  }
}

function seedFitzy(n: number) {
  const now = new Date().toISOString();
  for (let i = 0; i < n; i++) {
    getDb().fitzy_message_log.push({ user_id: USER, created_at: now });
  }
}

function setTier(tier: 'free' | 'premium') {
  getDb().profiles.get(USER)!.subscription_tier = tier;
}

function setGate(key: string, tier: 'free' | 'premium') {
  getDb().feature_gates.set(key, tier);
}

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, { id: USER, subscription_tier: 'free' });
  // All gates seeded DARK, as migration 075 ships them.
  for (const key of [
    'food_ai_unlimited', 'fitzy_unlimited', 'history_extended', 'circles_unlimited',
    'ads_removed', 'data_export', 'share_themes_custom', 'streak_shields_bonus',
  ]) {
    db.feature_gates.set(key, 'free');
  }
  setDb(db);
});

describe('assertFoodAiQuota — gates dark (pre-077 regression guard)', () => {
  it('applies the legacy 25/day cap to everyone, as RateLimited', async () => {
    seedParses(LEGACY_LIMITS.foodAiParsesPerDay - 1);
    await expect(UsageService.assertFoodAiQuota(USER)).resolves.toBeUndefined();

    seedParses(1); // now at 25
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.toThrow('RateLimited');
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.not.toBeInstanceOf(UpgradeRequiredError);
  });
});

describe('assertFoodAiQuota — gate live', () => {
  beforeEach(() => setGate('food_ai_unlimited', 'premium'));

  it('free user under the limit passes', async () => {
    seedParses(TIER_LIMITS.free.foodAiParsesPerDay - 1);
    await expect(UsageService.assertFoodAiQuota(USER)).resolves.toBeUndefined();
  });

  it('free user at the limit gets UpgradeRequiredError with {feature, used, limit}', async () => {
    seedParses(TIER_LIMITS.free.foodAiParsesPerDay);
    const err = await UsageService.assertFoodAiQuota(USER).catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err.feature).toBe('food_ai_unlimited');
    expect(err.used).toBe(5);
    expect(err.limit).toBe(5);
  });

  it('premium user passes the free limit and hits the abuse ceiling as RateLimited', async () => {
    setTier('premium');
    seedParses(TIER_LIMITS.free.foodAiParsesPerDay + 1);
    await expect(UsageService.assertFoodAiQuota(USER)).resolves.toBeUndefined();

    getDb().nutrition_parse_log.length = 0;
    seedParses(TIER_LIMITS.premium.foodAiParsesPerDay);
    const err = await UsageService.assertFoodAiQuota(USER).catch((e) => e);
    expect(err).not.toBeInstanceOf(UpgradeRequiredError); // abuse ≠ upgrade prompt
    expect(err.message).toBe('RateLimited');
  });
});

describe('assertFitzyQuota', () => {
  it('is a no-op while the gate is dark (Fitzy historically uncapped)', async () => {
    seedFitzy(500);
    await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined();
  });

  it('free user at 5 messages gets UpgradeRequiredError once live', async () => {
    setGate('fitzy_unlimited', 'premium');
    seedFitzy(TIER_LIMITS.free.fitzyMessagesPerDay);
    const err = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err.limit).toBe(5);
  });

  it('premium user is capped only by the abuse ceiling', async () => {
    setGate('fitzy_unlimited', 'premium');
    setTier('premium');
    seedFitzy(TIER_LIMITS.free.fitzyMessagesPerDay + 10);
    await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined();
  });
});

describe('checkCircleCreation', () => {
  const activeCircle = () => ({
    creator_id: USER,
    is_official: false,
    end_date: '2099-01-01',
  });

  it('returns null while the gate is dark', async () => {
    getDb().fitcircles.push(activeCircle(), activeCircle(), activeCircle());
    expect(await UsageService.checkCircleCreation(USER)).toBeNull();
  });

  it('free user with 2 active created circles is blocked once live', async () => {
    setGate('circles_unlimited', 'premium');
    getDb().fitcircles.push(activeCircle(), activeCircle());
    expect(await UsageService.checkCircleCreation(USER)).toEqual({ used: 2, limit: 2 });
  });

  it('expired and official circles do not count', async () => {
    setGate('circles_unlimited', 'premium');
    getDb().fitcircles.push(
      activeCircle(),
      { creator_id: USER, is_official: false, end_date: '2020-01-01' }, // ended
      { creator_id: USER, is_official: true, end_date: '2099-01-01' } // platform circle
    );
    expect(await UsageService.checkCircleCreation(USER)).toBeNull();
  });

  it('premium user is never blocked', async () => {
    setGate('circles_unlimited', 'premium');
    setTier('premium');
    getDb().fitcircles.push(activeCircle(), activeCircle(), activeCircle());
    expect(await UsageService.checkCircleCreation(USER)).toBeNull();
  });
});

describe('historyWindowDays', () => {
  it('is unlimited while dark, 14 for free / unlimited for premium once live', async () => {
    expect(await UsageService.historyWindowDays(USER)).toBe(Number.POSITIVE_INFINITY);

    getDb().feature_gates.set('history_extended', 'premium');
    expect(await UsageService.historyWindowDays(USER)).toBe(14);

    setTier('premium');
    expect(await UsageService.historyWindowDays(USER)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('EntitlementService.getEntitlements — payload additivity', () => {
  it('keeps the original shape and adds limits + subscription', async () => {
    const res = await EntitlementService.getEntitlements(USER);
    expect(res.tier).toBe('free');
    expect(res.features.body_comp_logging).toEqual({ allowed: true, requiredTier: 'free' });
    expect(res.features.food_ai_unlimited).toEqual({ allowed: true, requiredTier: 'free' });
    // Gates dark → legacy limits for everyone.
    expect(res.limits).toEqual({
      foodAiParsesPerDay: 25,
      fitzyMessagesPerDay: null, // legacy: uncapped
      maxActiveCreatedCircles: null,
      historyDays: null,
    });
    expect(res.subscription).toMatchObject({ status: null, platform: null, willRenew: false });
  });

  it('reflects live gates and free-tier limits after the 077 flip', async () => {
    for (const key of ['food_ai_unlimited', 'fitzy_unlimited', 'history_extended', 'circles_unlimited']) {
      setGate(key, 'premium');
    }
    const res = await EntitlementService.getEntitlements(USER);
    expect(res.features.food_ai_unlimited).toEqual({ allowed: false, requiredTier: 'premium' });
    expect(res.limits).toEqual({
      foodAiParsesPerDay: 5,
      fitzyMessagesPerDay: 5,
      maxActiveCreatedCircles: 2,
      historyDays: 14,
    });
  });

  it("normalizes legacy 'enterprise' to premium and unlocks live gates", async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'enterprise';
    setGate('food_ai_unlimited', 'premium');
    const res = await EntitlementService.getEntitlements(USER);
    expect(res.tier).toBe('premium');
    expect(res.features.food_ai_unlimited.allowed).toBe(true);
    expect(res.limits?.foodAiParsesPerDay).toBe(100); // premium abuse ceiling
  });

  it('fails open for known keys missing from the gate table', async () => {
    getDb().feature_gates.clear();
    const res = await EntitlementService.getEntitlements(USER);
    expect(res.features.body_comp_photo_scan).toEqual({ allowed: true, requiredTier: 'free' });
    expect(res.features.ads_removed).toEqual({ allowed: true, requiredTier: 'free' });
  });
});

describe('subscriptions master feature flag (fail-closed)', () => {
  it('defaults to OFF when no flag row exists', async () => {
    const res = await EntitlementService.getEntitlements(USER);
    expect(res.subscriptionsEnabled).toBe(false);
    expect(await EntitlementService.areSubscriptionsEnabled(USER)).toBe(false);
  });

  it('stays OFF when the row exists but is_enabled=false', async () => {
    getDb().feature_flags.push({
      name: 'subscriptions', is_enabled: false, rollout_percentage: 100,
      allowed_user_ids: [], allowed_tiers: [],
    });
    expect((await EntitlementService.getEntitlements(USER)).subscriptionsEnabled).toBe(false);
  });

  it('stays OFF when enabled but no rollout/allowlist covers the user', async () => {
    getDb().feature_flags.push({
      name: 'subscriptions', is_enabled: true, rollout_percentage: 0,
      allowed_user_ids: [], allowed_tiers: [],
    });
    expect((await EntitlementService.getEntitlements(USER)).subscriptionsEnabled).toBe(false);
  });

  it('turns ON via full rollout', async () => {
    getDb().feature_flags.push({
      name: 'subscriptions', is_enabled: true, rollout_percentage: 100,
      allowed_user_ids: [], allowed_tiers: [],
    });
    expect((await EntitlementService.getEntitlements(USER)).subscriptionsEnabled).toBe(true);
    expect(await EntitlementService.areSubscriptionsEnabled(USER)).toBe(true);
  });

  it('turns ON for allowlisted test accounts while off for everyone else', async () => {
    getDb().feature_flags.push({
      name: 'subscriptions', is_enabled: true, rollout_percentage: 0,
      allowed_user_ids: [USER], allowed_tiers: [],
    });
    expect((await EntitlementService.getEntitlements(USER)).subscriptionsEnabled).toBe(true);
  });
});

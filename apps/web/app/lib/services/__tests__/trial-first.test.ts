/**
 * Trial-first monetization (docs/TRIAL_FIRST_SPEC.md): the Fitzy chat gate, the lifetime
 * food AI allowance (race-safe, success-only), trial-aware paywall copy, remote-config
 * driven free limits, and the entitlements fields clients pre-gate from.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeDb, getDb, setDb } from './fake-supabase-admin';

vi.mock('../../supabase-admin', async () => {
  const { getDb } = await import('./fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});

import { TIER_LIMITS } from '../../config/tier-limits';
import { DEFAULT_TRIAL_DAYS } from '../../config/trial';
import { trialEligibleFromProfile } from '../../entitlements/trial-eligibility';
import { foodAiPaywall, foodAiUpgradeDetails, foodAiUpgradeMessage, fitzyUpgradeMessage, paywallFor } from '../../fitzy/paywall';
import { resetRemoteConfigCache } from '../../remote-config/service';
import { EntitlementService } from '../entitlement-service';
import { UpgradeRequiredError, UsageService } from '../usage-service';

const USER = '11111111-2222-3333-4444-555555555555';

function seedParses(n: number, at = new Date().toISOString()) {
  for (let i = 0; i < n; i++) getDb().nutrition_parse_log.push({ id: `seed-${i}-${at}`, user_id: USER, created_at: at });
}

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, { id: USER, subscription_tier: 'free', subscription_platform: null, trial_started_at: null, created_at: '2026-10-01T00:00:00Z' });
  for (const key of ['food_ai_unlimited', 'fitzy_unlimited', 'history_extended', 'circles_unlimited']) db.feature_gates.set(key, 'premium');
  setDb(db);
  resetRemoteConfigCache();
});

describe('trial eligibility (copy only)', () => {
  it('eligible = never trialed and no prior store subscription; unknown → not eligible', () => {
    expect(trialEligibleFromProfile({ trial_started_at: null, subscription_platform: null })).toBe(true);
    expect(trialEligibleFromProfile({ trial_started_at: null, subscription_platform: 'promotional' })).toBe(true); // lapsed grant
    expect(trialEligibleFromProfile({ trial_started_at: '2026-10-01T00:00:00Z', subscription_platform: null })).toBe(false);
    expect(trialEligibleFromProfile({ trial_started_at: null, subscription_platform: 'app_store' })).toBe(false);
    expect(trialEligibleFromProfile({ trial_started_at: null, subscription_platform: 'stripe' })).toBe(false);
    expect(trialEligibleFromProfile({ subscription_platform: null })).toBe(false); // column not read
    expect(trialEligibleFromProfile(null)).toBe(false);
  });
});

describe('Fitzy chat gate (TRIAL_FIRST_SPEC §1)', () => {
  it('free user: blocked before anything is recorded, error carries trial eligibility', async () => {
    const err = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err).toMatchObject({ feature: 'fitzy_unlimited', used: 0, limit: 0, trialEligible: true });
    expect(getDb().fitzy_message_log).toHaveLength(0);

    getDb().profiles.get(USER)!.trial_started_at = '2026-09-01T00:00:00Z';
    const again = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(again.trialEligible).toBe(false);
  });

  it('trial (premium + trialing) and premium are allowed; the 200/day abuse ceiling is unchanged', async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'premium';
    getDb().profiles.get(USER)!.subscription_status = 'trialing';
    await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined();
    const now = new Date().toISOString();
    for (let i = 0; i < TIER_LIMITS.premium.fitzyMessagesPerDay; i++) getDb().fitzy_message_log.push({ user_id: USER, created_at: now });
    const err = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(err).not.toBeInstanceOf(UpgradeRequiredError);
    expect(err.message).toBe('RateLimited');
  });

  it('gate dark → no-op for everyone (legacy)', async () => {
    getDb().feature_gates.set('fitzy_unlimited', 'free');
    await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined();
  });
});

describe('paywall copy', () => {
  it('fitzy_quota with trial eligibility → trial-first headline/cta + additive fields', () => {
    expect(paywallFor('fitzy_quota', { trialEligible: true })).toEqual({
      trigger: 'fitzy_quota',
      headline: 'Try Pro free for 7 days',
      bullets: ['Unlimited coaching with Fitzy, every day', 'A weekly plan built around your goals', 'Fitzy remembers your routines and preferences', 'Cancel anytime'],
      cta: 'Start free trial',
      trialDays: 7,
      trialEligible: true,
    });
  });

  it('fitzy_quota without eligibility → non-trial copy', () => {
    expect(paywallFor('fitzy_quota', { trialEligible: false })).toMatchObject({ headline: 'Unlock Fitzy Pro', cta: 'Continue with Pro', trialDays: 7, trialEligible: false });
    expect(paywallFor('fitzy_quota', { trialEligible: false }).bullets).not.toContain('Cancel anytime');
  });

  it('other triggers and the no-opts form are unchanged (shipped payload)', () => {
    expect(paywallFor('weekly_plan')).toEqual({
      trigger: 'weekly_plan',
      headline: 'Your plan is ready',
      bullets: ['Unlimited coaching with Fitzy, every day', 'A weekly plan built around your goals', 'Fitzy remembers your routines and preferences'],
      cta: 'Unlock Fitzy Pro',
    });
  });

  it('chat messages', () => {
    expect(fitzyUpgradeMessage(0, true)).toBe('Start your free trial to chat with Fitzy.');
    expect(fitzyUpgradeMessage(0, false)).toBe('Upgrade to Pro to chat with Fitzy.');
    expect(fitzyUpgradeMessage(5, true)).toMatch(/used today's free Fitzy messages/);
  });

  it('food AI paywall: trigger food_ai, trial-aware copy, legacy details kept', () => {
    expect(foodAiPaywall(5, true)).toEqual({
      trigger: 'food_ai',
      headline: 'Unlock food logging analysis',
      body: "You've used your 5 free AI food analyses. Start your free 7-day trial to keep logging with AI.",
      bullets: ['AI analysis for every meal photo and description', 'Calories and macros in seconds', 'Fitzy coaching and your weekly plan', 'Cancel anytime'],
      cta: 'Start free trial',
      trialDays: 7,
      trialEligible: true,
    });
    expect(foodAiPaywall(5, false)).toMatchObject({ body: "You've used your 5 free AI food analyses. Upgrade to Pro to keep logging with AI.", cta: 'Continue with Pro' });
    expect(foodAiUpgradeMessage(5, true, true)).toMatch(/We saved your photo/);
    const details = foodAiUpgradeDetails(new UpgradeRequiredError('food_ai_unlimited', 5, 5, true));
    expect(details).toMatchObject({ feature: 'food_ai_unlimited', used: 5, limit: 5, paywall: { trigger: 'food_ai', trialEligible: true } });
  });
});

describe('food AI lifetime allowance (TRIAL_FIRST_SPEC §5)', () => {
  it('counts every analysis ever, not just today', async () => {
    seedParses(3, '2026-10-02T10:00:00Z');
    seedParses(2, '2026-10-20T10:00:00Z');
    const err = await UsageService.reserveFoodAi(USER, 'h').catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err).toMatchObject({ used: 5, limit: 5, trialEligible: true });
    expect(getDb().nutrition_parse_log).toHaveLength(5); // the refused reservation was removed
  });

  it('a reservation holds a credit; release() gives it back (success-only counting)', async () => {
    seedParses(4, '2026-10-02T10:00:00Z');
    const r = await UsageService.reserveFoodAi(USER, 'photo-hash');
    expect(getDb().nutrition_parse_log).toHaveLength(5);
    await r.release(); // the model failed
    expect(getDb().nutrition_parse_log).toHaveLength(4);
    const kept = await UsageService.reserveFoodAi(USER, 'photo-hash-2'); // success: kept
    expect(kept.id).toBeTruthy();
    await expect(UsageService.reserveFoodAi(USER, 'h3')).rejects.toBeInstanceOf(UpgradeRequiredError);
  });

  it('race: two parallel analyses at 4/5 can never both pass', async () => {
    seedParses(4, '2026-10-02T10:00:00Z');
    const results = await Promise.allSettled([UsageService.reserveFoodAi(USER, 'a'), UsageService.reserveFoodAi(USER, 'b')]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
    expect(getDb().nutrition_parse_log.length).toBeLessThanOrEqual(5);
  });

  it('race: ten parallel analyses from zero never exceed the allowance', async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => UsageService.reserveFoodAi(USER, `h${i}`)));
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(5);
    expect(getDb().nutrition_parse_log.length).toBeLessThanOrEqual(5);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(UpgradeRequiredError);
  });

  it('Pro / trial: lifetime history ignored, only the 100/day ceiling (RateLimited)', async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'premium';
    seedParses(50, '2026-10-02T10:00:00Z');
    await expect(UsageService.reserveFoodAi(USER, 'x')).resolves.toBeTruthy();
    getDb().nutrition_parse_log.length = 0;
    seedParses(TIER_LIMITS.premium.foodAiParsesPerDay);
    const err = await UsageService.reserveFoodAi(USER, 'y').catch((e) => e);
    expect(err).not.toBeInstanceOf(UpgradeRequiredError);
    expect(err.message).toBe('RateLimited');
  });

  it('lapsed trial: analyses made during the trial count toward the free allowance', async () => {
    seedParses(12, '2026-10-02T10:00:00Z'); // used while trialing
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);
  });
});

describe('trial length = remote config trial_days (single source of truth)', () => {
  it('code default is 7 days', () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(7);
    expect(paywallFor('fitzy_quota', { trialEligible: true })).toMatchObject({ headline: 'Try Pro free for 7 days', trialDays: 7 });
  });

  it('the resolved value rides on UpgradeRequiredError into the Fitzy + food paywall copy', async () => {
    getDb().remote_config_defaults.push({ config_key: 'trial_days', value: 3, updated_by: null, updated_at: '2026-11-01T00:00:00Z' });
    const chat = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(chat).toMatchObject({ trialEligible: true, trialDays: 3 });
    expect(paywallFor('fitzy_quota', { trialEligible: true, trialDays: chat.trialDays })).toMatchObject({ headline: 'Try Pro free for 3 days', trialDays: 3 });

    seedParses(5, '2026-10-02T10:00:00Z');
    const food = await UsageService.assertFoodAiQuota(USER).catch((e) => e);
    expect(food).toMatchObject({ feature: 'food_ai_unlimited', trialDays: 3 });
    expect(foodAiUpgradeMessage(food.limit, true, false, food.trialDays)).toBe("You've used your 5 free AI food analyses. Start your free 3-day trial to keep logging with AI.");
    expect(foodAiUpgradeDetails(food).paywall).toMatchObject({ trialDays: 3, body: expect.stringContaining('free 3-day trial') });
  });

  it('a platform rule (store offer not switched yet) wins for that platform only', async () => {
    getDb().remote_config_rules.push({
      id: 'aaaaaaaa-0000-4000-8000-000000000009',
      config_key: 'trial_days',
      name: 'iOS offer still 3 days',
      enabled: true,
      priority: 10,
      audience: { platforms: ['ios'] },
      value: 3,
      created_at: '2026-11-01T00:00:00Z',
    });
    const { TrialConfig } = await import('../trial-config');
    expect(await TrialConfig.days(USER, { platform: 'ios' })).toBe(3);
    expect(await TrialConfig.days(USER, { platform: 'android' })).toBe(7);
    expect(await TrialConfig.webDays(USER)).toBe(7);
    expect(await TrialConfig.mobileDays(USER)).toBe(3); // cron copy never over-promises
  });
});

describe('remote config drives the free limits (TRIAL_FIRST_SPEC §6)', () => {
  it('admin default raises the food allowance; entitlements report total + remaining', async () => {
    getDb().remote_config_defaults.push({ config_key: 'free_food_ai_analyses_total', value: 8, updated_by: 'a@x', updated_at: '2026-11-01T00:00:00Z' });
    seedParses(6, '2026-10-02T10:00:00Z');
    await expect(UsageService.assertFoodAiQuota(USER)).resolves.toBeUndefined();
    const e = await EntitlementService.getEntitlements(USER);
    expect(e.limits).toMatchObject({ foodAiAnalysesTotal: 8, foodAiAnalysesRemaining: 2, fitzyMessagesPerDay: 0 });
  });

  it('a matching rule wins over the default; lowering below usage just means 0 remaining', async () => {
    getDb().remote_config_defaults.push({ config_key: 'free_food_ai_analyses_total', value: 8, updated_by: null, updated_at: '2026-11-01T00:00:00Z' });
    getDb().remote_config_rules.push({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      config_key: 'free_food_ai_analyses_total',
      name: 'QA cohort',
      enabled: true,
      priority: 10,
      audience: { userIds: [USER] },
      value: 2,
      created_at: '2026-11-01T00:00:00Z',
    });
    seedParses(3, '2026-10-02T10:00:00Z');
    const e = await EntitlementService.getEntitlements(USER);
    expect(e.limits).toMatchObject({ foodAiAnalysesTotal: 2, foodAiAnalysesRemaining: 0 });
    const err = await UsageService.assertFoodAiQuota(USER).catch((x) => x);
    expect(err).toMatchObject({ used: 3, limit: 2 });
  });

  it('free Fitzy messages can be opened up again (e.g. 3/day) without a deploy', async () => {
    getDb().remote_config_defaults.push({ config_key: 'free_fitzy_messages_per_day', value: 3, updated_by: null, updated_at: '2026-11-01T00:00:00Z' });
    await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined();
    expect((await UsageService.fitzyAllowance(USER)).remaining).toBe(3);
    const e = await EntitlementService.getEntitlements(USER);
    expect(e.limits?.fitzyMessagesPerDay).toBe(3);
  });

  it('Pro / trial users get null food limits and the premium Fitzy ceiling', async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'premium';
    const e = await EntitlementService.getEntitlements(USER);
    expect(e.limits).toMatchObject({ foodAiAnalysesTotal: null, foodAiAnalysesRemaining: null, fitzyMessagesPerDay: 200 });
    expect(Object.values(e.features).every((f) => f.allowed)).toBe(true);
  });
});

/**
 * Release 1.1.5 allowances on the REAL client headers (docs/ENGAGEMENT_115_SPEC.md §2, §3, §9):
 * daily free scans after the 21 lifetime starter scans and 3 free Fitzy messages per local week,
 * both only for apps >= 1.1.5 (version rules), with 1.1.2–1.1.4 / header-less requests unchanged.
 *
 * Deploy-time config is modelled exactly: admin defaults unset for the new keys (code default 0),
 * free_food_ai_analyses_total = 21, and per-platform `appVersionGte: '1.1.5'` rules → 2 / 3.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => h.headers }));
vi.mock('@/lib/supabase-admin', async () => {
  const { getDb } = await import('@/lib/services/__tests__/fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getDb } = await import('@/lib/services/__tests__/fake-supabase-admin');
  return {
    requireMobileAuth: async () => {
      const p = getDb().profiles.get(USER);
      if (!p) throw new Error('Unauthorized');
      return { ...p };
    },
  };
});

import { describeFitzyError } from '@/lib/fitzy/http';
import { foodAiUpgradeDetails, foodAiUpgradeMessage } from '@/lib/fitzy/paywall';
import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { FakeDb, getDb, setDb } from '@/lib/services/__tests__/fake-supabase-admin';
import { UpgradeRequiredError, UsageService } from '@/lib/services/usage-service';

import { GET as entitlements } from '../entitlements/route';

const USER = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const TZ = 'America/New_York';
const fixture = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(join(__dirname, '..', 'home-feed', '__tests__', 'fixtures', name), 'utf8')).headers;
const IOS = fixture('ios-1.0.8.request.json');
const ANDROID = fixture('android-1.0.8.request.json');

/** Set the request headers (next/headers + the route request). */
const as = (base: Record<string, string> | null, version?: string, tz: string | null = TZ) => {
  const hdrs = new Headers(base ?? {});
  if (version) hdrs.set('X-App-Version', version);
  else hdrs.delete('X-App-Version');
  if (tz) hdrs.set('X-Client-Timezone', tz);
  else hdrs.delete('X-Client-Timezone');
  h.headers = hdrs;
  return new NextRequest('https://www.fitcircle.ai/api/mobile/entitlements', { headers: hdrs });
};

const rule = (id: string, platform: 'ios' | 'android', key: string, value: number) => ({
  id,
  config_key: key,
  name: `${platform} 1.1.5+`,
  enabled: true,
  priority: 10,
  audience: { platforms: [platform], appVersionGte: '1.1.5' },
  value,
  created_at: '2026-11-13T00:00:00Z',
});

const NOW = new Date('2026-11-13T17:00:00Z'); // Fri 12:00 New York
const YESTERDAY = '2026-11-12T17:00:00.000Z';
const TODAY_EARLY = '2026-11-13T06:00:00.000Z'; // 01:00 New York, today
const LAST_SUNDAY = '2026-11-09T04:30:00.000Z'; // Sun 23:30 New York, previous week

function seedScans(n: number, at: string, user = USER) {
  for (let i = 0; i < n; i++) getDb().nutrition_parse_log.push({ id: `s-${user}-${at}-${i}`, user_id: user, created_at: at });
}
function seedFitzy(n: number, row: Record<string, unknown>) {
  for (let i = 0; i < n; i++) getDb().fitzy_message_log.push({ user_id: USER, created_at: TODAY_EARLY, ...row });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  const db = new FakeDb();
  db.profiles.set(USER, {
    id: USER, subscription_tier: 'free', subscription_platform: null, trial_started_at: null,
    created_at: '2026-10-01T00:00:00Z', onboarding_completed: true, timezone: null,
  });
  for (const k of ['food_ai_unlimited', 'fitzy_unlimited']) db.feature_gates.set(k, 'premium');
  db.remote_config_defaults.push({ config_key: 'free_food_ai_analyses_total', value: 21, updated_by: 'ops', updated_at: '2026-11-06T00:00:00Z' });
  db.remote_config_rules.push(
    rule('00000000-0000-4000-8000-0000000000b1', 'ios', 'free_food_ai_daily_after_total', 2),
    rule('00000000-0000-4000-8000-0000000000b2', 'android', 'free_food_ai_daily_after_total', 2),
    rule('00000000-0000-4000-8000-0000000000b3', 'ios', 'free_fitzy_messages_per_week', 3),
    rule('00000000-0000-4000-8000-0000000000b4', 'android', 'free_fitzy_messages_per_week', 3)
  );
  setDb(db);
  resetRemoteConfigCache();
});
afterEach(() => vi.useRealTimers());

const ent = async (req: NextRequest) => (await (await entitlements(req)).json()).data;

describe.each([
  ['iOS', IOS],
  ['Android', ANDROID],
])('F2 daily scans, %s', (_label, base) => {
  it('1.1.5 in the starter phase: remaining = starter left, dailyLimit announced', async () => {
    seedScans(19, YESTERDAY);
    const data = await ent(as(base, '1.1.5'));
    expect(data.allowances.foodScans).toEqual({
      mode: 'starter', remaining: 2, starterTotal: 21, starterRemaining: 2, dailyLimit: 2, dailyRemaining: null, resetsAt: null, timezone: TZ,
    });
    expect(data.limits).toMatchObject({ foodAiAnalysesTotal: 21, foodAiAnalysesRemaining: 2 });
  });

  it('1.1.5 after the starter: 2 per local day, then a refusal BEFORE any model call', async () => {
    seedScans(21, YESTERDAY);
    let data = await ent(as(base, '1.1.5'));
    expect(data.allowances.foodScans).toMatchObject({ mode: 'daily', remaining: 2, dailyRemaining: 2, resetsAt: '2026-11-14T05:00:00.000Z' });
    expect(data.limits.foodAiAnalysesRemaining).toBe(2); // legacy meter = what the next scan may use

    await expect(UsageService.reserveFoodAi(USER, 'a')).resolves.toMatchObject({ id: expect.any(String) });
    await expect(UsageService.reserveFoodAi(USER, 'b')).resolves.toMatchObject({ id: expect.any(String) });
    const err = await UsageService.reserveFoodAi(USER, 'c').catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err).toMatchObject({ feature: 'food_ai_unlimited', used: 2, limit: 2 });
    expect(err.extra.phase).toBe('daily');
    expect(err.extra.allowance).toMatchObject({ mode: 'daily', remaining: 0, dailyRemaining: 0 });
    expect(getDb().nutrition_parse_log).toHaveLength(23); // the refused reservation row was deleted
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);

    data = await ent(as(base, '1.1.5'));
    expect(data.allowances.foodScans).toMatchObject({ mode: 'daily', remaining: 0 });
  });

  it('a new local day resets the daily allowance', async () => {
    seedScans(21, YESTERDAY);
    seedScans(2, TODAY_EARLY);
    as(base, '1.1.5');
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);
    vi.setSystemTime(new Date('2026-11-14T05:00:01Z')); // 00:00:01 New York, Saturday
    await expect(UsageService.assertFoodAiQuota(USER)).resolves.toBeUndefined();
  });

  it('the day the starter runs out, starter scans that day do not use the daily 2', async () => {
    seedScans(18, YESTERDAY);
    seedScans(3, TODAY_EARLY); // the last 3 starter scans, today
    const data = await ent(as(base, '1.1.5'));
    expect(data.allowances.foodScans).toMatchObject({ mode: 'daily', remaining: 2 });
  });

  it('the local day is the request zone (Tokyo is already Saturday)', async () => {
    seedScans(21, YESTERDAY);
    seedScans(2, TODAY_EARLY); // Fri 15:00 Tokyo — but now is Sat 02:00 Tokyo
    const data = await ent(as(base, '1.1.5', 'Asia/Tokyo'));
    expect(data.allowances.foodScans).toMatchObject({ mode: 'daily', remaining: 2, timezone: 'Asia/Tokyo', resetsAt: '2026-11-14T15:00:00.000Z' });
  });

  it('daily phase counts the shared mailbox (max over the mailbox group)', async () => {
    getDb().profiles.get(USER)!.email_canonical = 'a@x.com';
    getDb().profiles.set(OTHER, { id: OTHER, subscription_tier: 'free', email_canonical: 'a@x.com' });
    seedScans(21, YESTERDAY);
    seedScans(2, TODAY_EARLY, OTHER);
    as(base, '1.1.5');
    const err = await UsageService.assertFoodAiQuota(USER).catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err.extra.phase).toBe('daily');
  });

  it('1.1.4: unchanged (21 then the starter paywall, no daily allowance, lifetime meter)', async () => {
    seedScans(21, YESTERDAY);
    const data = await ent(as(base, '1.1.4'));
    expect(data.limits).toMatchObject({ foodAiAnalysesTotal: 21, foodAiAnalysesRemaining: 0 });
    expect(data.allowances.foodScans).toMatchObject({ mode: 'exhausted', remaining: 0, dailyLimit: null });
    const err = await UsageService.reserveFoodAi(USER, 'x').catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err).toMatchObject({ used: 21, limit: 21 });
    expect(err.extra.phase).toBe('exhausted');
    // Same copy and legacy keys as 1.1.4 (allowance is an extra key old clients ignore).
    expect(foodAiUpgradeMessage(err.limit, false, false, err.trialDays, err.extra.phase)).toBe(
      "You've used your 21 free AI food analyses. Upgrade to Pro to keep logging with AI."
    );
    expect(foodAiUpgradeDetails(err).paywall.headline).toBe('Unlock food logging analysis');
  });

  it('1.1.4 in the starter phase: legacy meter stays the lifetime count', async () => {
    seedScans(10, YESTERDAY);
    const data = await ent(as(base, '1.1.4'));
    expect(data.limits.foodAiAnalysesRemaining).toBe(11);
    expect(data.allowances.foodScans).toMatchObject({ mode: 'starter', remaining: 11, dailyLimit: null });
  });
});

describe('F2 other tiers and requests', () => {
  it('no headers (web, crons): the daily key resolves 0 → exhausted', async () => {
    seedScans(21, YESTERDAY);
    const data = await ent(as(null, undefined, null));
    expect(data.allowances.foodScans).toMatchObject({ mode: 'exhausted', remaining: 0, timezone: 'America/New_York' });
    await expect(UsageService.assertFoodAiQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);
  });

  it('Pro → unlimited, the 100/day ceiling is a RateLimited, never a paywall', async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'premium';
    seedScans(30, YESTERDAY);
    const data = await ent(as(IOS, '1.1.5'));
    expect(data.allowances.foodScans).toEqual({
      mode: 'unlimited', remaining: null, starterTotal: null, starterRemaining: null, dailyLimit: null, dailyRemaining: null, resetsAt: null, timezone: TZ,
    });
    await expect(UsageService.reserveFoodAi(USER, 'p')).resolves.toBeTruthy();
  });

  it('gate dark → legacy', async () => {
    getDb().feature_gates.set('food_ai_unlimited', 'free');
    const data = await ent(as(IOS, '1.1.5'));
    expect(data.allowances.foodScans.mode).toBe('legacy');
  });

  it('daily-phase paywall copy says "Scan every meal", never "unlimited"', () => {
    const err = new UpgradeRequiredError('food_ai_unlimited', 2, 2, true, 7, { phase: 'daily', allowance: { mode: 'daily' } as any });
    expect(foodAiUpgradeMessage(2, true, false, 7, 'daily')).toBe("You've used today's 2 free AI scans.");
    expect(foodAiUpgradeMessage(2, true, true, 7, 'daily')).toBe("You've used today's 2 free AI scans. We saved your photo so you can add the details.");
    const details = foodAiUpgradeDetails(err);
    expect(details).toMatchObject({
      feature: 'food_ai_unlimited', used: 2, limit: 2, allowance: { mode: 'daily' },
      paywall: { headline: 'Scan every meal', body: "You've used today's 2 free scans. They reset at midnight, or scan every meal with Pro." },
    });
    expect(JSON.stringify(details.paywall).toLowerCase()).not.toContain('unlimited scan');
  });
});

describe.each([
  ['iOS', IOS],
  ['Android', ANDROID],
])('F3 weekly Fitzy, %s', (_label, base) => {
  it('1.1.5: 3 free per local week; the 4th is refused before any write, with window + resetsAt', async () => {
    as(base, '1.1.5');
    for (let i = 0; i < 3; i++) {
      const d = await UsageService.assertFitzyQuota(USER);
      expect(d).toEqual({ tier: 'free', context: null });
      await UsageService.recordFitzyMessage(USER, d);
    }
    expect(getDb().fitzy_message_log.every((r) => r.tier === 'free' && r.context === null)).toBe(true);
    expect(await UsageService.fitzyAllowance(USER)).toEqual({ tier: 'free', remaining: 0, limit: 3, window: 'week', resetsAt: '2026-11-16T05:00:00.000Z' });

    const err = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err).toMatchObject({ used: 3, limit: 3 });
    expect(getDb().fitzy_message_log).toHaveLength(3);
    const d = describeFitzyError(err);
    expect(d).toMatchObject({
      status: 429, code: 'UPGRADE_REQUIRED',
      message: "You've used this week's 3 free Fitzy messages. They reset Monday.",
      details: { feature: 'fitzy_unlimited', used: 3, limit: 3, window: 'week', resetsAt: '2026-11-16T05:00:00.000Z' },
    });
    expect(err.trialEligible).toBe(true); // never trialed → trial headline
    expect(d.paywall?.headline).toBe('Try Pro free for 7 days');
    getDb().profiles.get(USER)!.trial_started_at = '2026-10-02T00:00:00Z'; // used the trial
    const noTrial = describeFitzyError(await UsageService.assertFitzyQuota(USER).catch((e) => e));
    expect(noTrial.paywall?.headline).toBe('Keep chatting with Fitzy');
  });

  it('entitlements allowances.fitzy in weekly mode; the daily key is ignored', async () => {
    seedFitzy(1, { tier: 'free', context: null });
    const data = await ent(as(base, '1.1.5'));
    expect(data.allowances.fitzy).toEqual({ mode: 'weekly', limit: 3, used: 1, remaining: 2, window: 'week', resetsAt: '2026-11-16T05:00:00.000Z' });
    expect(data.limits.fitzyMessagesPerDay).toBe(0); // legacy field unchanged
  });

  it('onboarding-tour, trial / Pro and pre-138 (tier null) messages never count; last week does not count', async () => {
    seedFitzy(2, { tier: 'free', context: 'onboarding' });
    seedFitzy(2, { tier: 'pro', context: null });
    seedFitzy(2, {}); // written before migration 138
    getDb().fitzy_message_log.push({ user_id: USER, created_at: LAST_SUNDAY, tier: 'free', context: null });
    seedFitzy(1, { tier: 'free', context: null });
    const data = await ent(as(base, '1.1.5'));
    expect(data.allowances.fitzy).toMatchObject({ used: 1, remaining: 2 });
  });

  it('the onboarding tour stays answerable and is recorded as context onboarding', async () => {
    getDb().profiles.get(USER)!.onboarding_completed = false;
    seedFitzy(3, { tier: 'free', context: null });
    as(base, '1.1.5');
    const d = await UsageService.assertFitzyQuota(USER, { onboarding: true }).catch((e) => e);
    // 3 messages today already: the tour exemption (3/day) is used up → weekly check → refused.
    expect(d).toBeInstanceOf(UpgradeRequiredError);
    getDb().fitzy_message_log = [];
    const ok = await UsageService.assertFitzyQuota(USER, { onboarding: true });
    expect(ok).toEqual({ tier: 'free', context: 'onboarding' });
    await UsageService.recordFitzyMessage(USER, ok);
    expect(getDb().fitzy_message_log[0]).toMatchObject({ tier: 'free', context: 'onboarding' });
  });

  it('1.1.4: unchanged — the daily key (0) refuses the first message with the 1.1.4 envelope', async () => {
    as(base, '1.1.4');
    const err = await UsageService.assertFitzyQuota(USER).catch((e) => e);
    expect(err).toBeInstanceOf(UpgradeRequiredError);
    expect(err).toMatchObject({ used: 0, limit: 0 });
    const d = describeFitzyError(err);
    expect(d.details).toEqual({ feature: 'fitzy_unlimited', used: 0, limit: 0 }); // no window / resetsAt
    expect(d.message).toMatch(/to chat with Fitzy\.$/);
    const data = await ent(as(base, '1.1.4'));
    expect(data.allowances.fitzy).toMatchObject({ mode: 'locked', limit: 0, remaining: 0, window: 'day' });
  });
});

describe('F3 Pro and gate dark', () => {
  it('Pro: unlimited allowance, all fields null; messages recorded as pro', async () => {
    getDb().profiles.get(USER)!.subscription_tier = 'premium';
    const data = await ent(as(IOS, '1.1.5'));
    expect(data.allowances.fitzy).toEqual({ mode: 'unlimited', limit: null, used: null, remaining: null, window: null, resetsAt: null });
    const d = await UsageService.assertFitzyQuota(USER);
    await UsageService.recordFitzyMessage(USER, d);
    expect(getDb().fitzy_message_log[0]).toMatchObject({ tier: 'pro' });
    expect(await UsageService.fitzyAllowance(USER)).toEqual({ tier: 'pro', remaining: null, limit: null, window: null, resetsAt: null });
  });

  it('gate dark: unlimited, no-op', async () => {
    getDb().feature_gates.set('fitzy_unlimited', 'free');
    const data = await ent(as(IOS, '1.1.5'));
    expect(data.allowances.fitzy.mode).toBe('unlimited');
  });

  it('clientConfig defaults on; remote config can switch each off', async () => {
    expect((await ent(as(IOS, '1.1.5'))).clientConfig).toEqual({ mealSharePrompt: true, streakSaveOffer: true });
    getDb().remote_config_defaults.push({ config_key: 'meal_share_prompt', value: 'off', updated_by: 'ops', updated_at: '2026-11-13T00:00:00Z' });
    resetRemoteConfigCache();
    expect((await ent(as(IOS, '1.1.5'))).clientConfig).toEqual({ mealSharePrompt: false, streakSaveOffer: true });
  });
});

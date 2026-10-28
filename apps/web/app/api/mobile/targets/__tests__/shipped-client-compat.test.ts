/**
 * Shipped-client compatibility (apps <= 1.0.9) for the 1.1.0 user-targets work
 * (docs/USER_TARGETS_CONTRACT.md §6):
 *
 *  - A user whose targets were saved by a 1.1.0 client (PUT /api/mobile/targets)
 *    and who then opens a shipped build: the profile payload (toMobileUser — every
 *    profile/auth response) still decodes as the iOS `User` (closed goals[].type
 *    enum, required preference tree) and the Android profile; the steps target
 *    is the existing goals[type=steps] element; preferences.nutrition is an extra
 *    pass-through key.
 *  - Vitals summary / hydration keep their exact shape; the water goal is the same
 *    store, so shipped apps see the saved water target.
 *  - Plate score: same DTO keys; basis gains only the optional `targetSource`.
 *  - GET /api/mobile/entitlements: proBadge + memberSince are additive; the
 *    response still decodes on shipped iOS / Android, with migrations 112 and 115
 *    applied or not (missing columns fail soft).
 *  - POST /me/journey/events paywall_shown: same response with or without 115.
 *  - Onboarding progress / plan / complete: shipped bodies get the same responses.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { proOfferCampaignsCache } from '../../../../lib/services/entitlement-service';
import { toMobileUser } from '../../../../lib/services/mobile-profile-response';
import { PlateScoreService } from '../../../../lib/services/plate-score-service';
import { VitalsService } from '../../../../lib/services/vitals-service';
import { GET as GET_ENTITLEMENTS } from '../../entitlements/route';
import { POST as POST_EVENT } from '../../me/journey/events/route';
import { POST as POST_PLAN } from '../../onboarding/plan/route';
import { PATCH as PATCH_PROGRESS } from '../../onboarding/progress/route';
import { PUT } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: vi.fn(async () => ({ ...db.getRows('profiles')[0] })) }));

const USER = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-27T15:00:00Z');
let db: FakeSupabase;
/** Columns that don't exist yet (simulates an unapplied migration). */
let missing: RegExp | null = null;

function client() {
  return {
    from(table: string) {
      const q = db.from(table) as any;
      if (!missing) return q;
      const err = { data: null, error: { code: '42703', message: 'column does not exist' } };
      const failing: any = { then: (r: any, j: any) => Promise.resolve(err).then(r, j), maybeSingle: async () => err, single: async () => err };
      for (const m of ['eq', 'in', 'is', 'order', 'limit', 'gte', 'lte', 'gt', 'lt', 'select']) failing[m] = () => failing;
      const select = q.select.bind(q);
      q.select = (cols?: string, opts?: any) => (cols && missing!.test(cols) ? failing : select(cols, opts));
      const update = q.update.bind(q);
      q.update = (patch: Record<string, unknown>) => (Object.keys(patch).some((k) => missing!.test(k)) ? failing : update(patch));
      return q;
    },
  };
}

const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`https://api.test${path}`, {
    method,
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  missing = null;
  proOfferCampaignsCache.clear();
  db = new FakeSupabase({
    profiles: {
      uniqueKey: ['id'],
      rows: [
        {
          id: USER,
          username: 'ani',
          email: 'a@b.com',
          created_at: '2026-10-01T00:00:00Z',
          timezone: 'UTC',
          subscription_tier: 'free',
          subscription_status: null,
          subscription_will_renew: false,
          onboarding_gate: 'none',
          trial_ends_at: null,
          trial_started_at: null,
          paywall_last_opened_at: null,
          preferences: { hydration: { daily_water_ml_target: 2000 } },
          goals: [{ type: 'weight', target_weight_kg: 80, starting_weight_kg: 90, daily_steps_target: null }],
        },
      ],
    },
    feature_gates: { rows: [{ feature_key: 'food_ai_unlimited', required_tier: 'premium' }] },
    feature_flags: { rows: [{ name: 'subscriptions', is_enabled: true, rollout_percentage: 100 }] },
    campaigns: {
      rows: [
        { id: 'c1', slug: 'bf2026', published: true, archived_at: null, featured_from: '2026-11-20', starts_at: '2026-11-27', ends_at: '2026-11-30', priority: 0, cta: { action: 'paywall' } },
      ],
    },
    subscription_events: { rows: [] },
    onboarding_progress: { uniqueKey: ['user_id'] },
    plate_scores: { uniqueKey: ['user_id', 'score_date'] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(client() as any);
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------- shipped decoders

const IOS_GOAL_TYPES = ['weight', 'steps', 'workout_minutes'];
const isInt = (v: any) => typeof v === 'number' && Number.isInteger(v);
const optStr = (v: any) => v == null || typeof v === 'string';
const optBool = (v: any) => v == null || typeof v === 'boolean';

/** iOS `User` (Core/Models/User.swift): required keys, closed goal enum, Int steps, preference tree. */
function iosUser(u: any): string[] {
  const p: string[] = [];
  for (const k of ['id', 'username', 'display_name', 'email', 'timezone', 'last_active_at', 'created_at', 'updated_at']) if (typeof u[k] !== 'string') p.push(k);
  for (const k of ['total_points', 'current_streak', 'longest_streak', 'challenges_completed', 'challenges_won']) if (!isInt(u[k])) p.push(k);
  if (!Array.isArray(u.goals)) p.push('goals');
  for (const g of u.goals ?? []) {
    if (!IOS_GOAL_TYPES.includes(g.type)) p.push(`goals.type=${g.type}`);
    if (g.daily_steps_target != null && !isInt(g.daily_steps_target)) p.push('goals.daily_steps_target');
  }
  const pr = u.preferences;
  if (typeof pr?.notifications?.push !== 'boolean') p.push('preferences.notifications');
  if (typeof pr?.privacy?.profile_visibility !== 'string') p.push('preferences.privacy');
  if (typeof pr?.display?.units !== 'string') p.push('preferences.display');
  return p;
}

/** Shipped iOS / Android entitlements (copied from entitlements/__tests__/shipped-client-compat.test.ts). */
function shippedEntitlements(b: any): string[] {
  const p: string[] = [];
  if (b?.success !== true || b?.data == null) return ['success && data'];
  const d = b.data;
  if (typeof d.tier !== 'string') p.push('tier');
  for (const [k, f] of Object.entries<any>(d.features ?? {})) if (typeof f?.allowed !== 'boolean' || typeof f?.requiredTier !== 'string') p.push(`features.${k}`);
  if (d.limits != null) for (const k of ['foodAiParsesPerDay', 'fitzyMessagesPerDay', 'maxActiveCreatedCircles', 'historyDays']) if (d.limits[k] != null && !isInt(d.limits[k])) p.push(`limits.${k}`);
  if (!optBool(d.subscriptionsEnabled)) p.push('subscriptionsEnabled');
  const s = d.subscription;
  if (s != null) {
    for (const k of ['status', 'platform', 'productId', 'expiresAt', 'source']) if (!optStr(s[k])) p.push(`subscription.${k}`);
    if (!optBool(s.willRenew)) p.push('subscription.willRenew');
  }
  return p;
}

/** The 1.1.0 additions' own contract. */
function newEntitlementFields(d: any): string[] {
  const p: string[] = [];
  if (typeof d.proBadge?.marker !== 'boolean') p.push('proBadge.marker');
  if (!optStr(d.proBadge?.offerId)) p.push('proBadge.offerId');
  if (!('memberSince' in d) || !optStr(d.memberSince)) p.push('memberSince');
  if (d.memberSince != null && Number.isNaN(Date.parse(d.memberSince))) p.push('memberSince.iso');
  return p;
}

// ---------------------------------------------------------------- tests

describe('targets saved by 1.1.0, read by shipped apps', () => {
  it('profile payload still decodes; steps target is the existing goals[type=steps] element', async () => {
    const res = await PUT(req('/api/mobile/targets', 'PUT', { calories: 1850, proteinG: 128, carbsG: 200, fatG: 60, waterMl: 2700, steps: 8000, origin: 'onboarding_plan' }));
    expect(res.status).toBe(200);
    const user = toMobileUser(db.getRows('profiles')[0], { id: USER, email: 'a@b.com' });
    expect(iosUser(user)).toEqual([]);
    expect(user.goals).toEqual([
      { type: 'weight', target_weight_kg: 80, starting_weight_kg: 90, daily_steps_target: null },
      { type: 'steps', target_weight_kg: null, starting_weight_kg: null, daily_steps_target: 8000 },
    ]);
    // Additive pass-through keys; hydration keeps the shape PUT /vitals/goals writes.
    expect(user.preferences.hydration).toEqual({ daily_water_ml_target: 2700 });
    expect(user.preferences.nutrition).toMatchObject({ daily_calorie_target: 1850, daily_protein_g_target: 128 });
  });

  it('vitals summary keeps its shape and shows the saved water goal', async () => {
    const before = await VitalsService.getSummary(USER, { days: 7, timezone: 'UTC' });
    await PUT(req('/api/mobile/targets', 'PUT', { waterMl: 2700 }));
    const after = await VitalsService.getSummary(USER, { days: 7, timezone: 'UTC' });
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(Object.keys(after.water).sort()).toEqual(Object.keys(before.water).sort());
    expect(after.water).toMatchObject({ goal_ml: 2700, goal_source: 'user' });
  });

  it('plate score DTO: same keys; basis only gains the optional targetSource', async () => {
    await PUT(req('/api/mobile/targets', 'PUT', { calories: 1850 }));
    const dto = await PlateScoreService.computeForDay(USER, '2026-11-27');
    expect(Object.keys(dto).sort()).toEqual(['breakdown', 'calorieTarget', 'components', 'date', 'score']);
    expect(isInt(dto.score) && typeof dto.calorieTarget === 'number').toBe(true);
    expect(Object.keys(dto.breakdown.basis).sort()).toEqual(['calorieTarget', 'fitnessLevel', 'persona', 'targetSource', 'usedChallengeTarget']);
    expect(dto.calorieTarget).toBe(1850);
  });
});

describe('GET /api/mobile/entitlements — proBadge + memberSince', () => {
  const variants: Array<[string, RegExp | null]> = [
    ['all migrations applied', null],
    ['115 not applied', /paywall_last_opened_at/],
    ['112 + 115 not applied', /trial_|onboarding_gate|paywall_last_opened_at/],
  ];
  for (const [label, cols] of variants) {
    it(`decodes on shipped iOS/Android (${label})`, async () => {
      missing = cols;
      const res = await GET_ENTITLEMENTS(req('/api/mobile/entitlements', 'GET'));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json();
      expect(shippedEntitlements(body)).toEqual([]);
      expect(newEntitlementFields(body.data)).toEqual([]);
      expect(body.data.proBadge).toEqual({ marker: true, offerId: 'campaign:bf2026' });
    });
  }

  it('marker clears after a paywall open (any placement), and re-arms for a newer offer', async () => {
    const event = await POST_EVENT(req('/api/mobile/me/journey/events', 'POST', { event: 'paywall_shown', placement: 'pro_badge', automatic: false }));
    expect((await event.json()).data).toEqual({ event: 'paywall_shown' }); // unchanged response for a tap
    const after = (await (await GET_ENTITLEMENTS(req('/api/mobile/entitlements', 'GET'))).json()).data;
    expect(after.proBadge).toEqual({ marker: false, offerId: 'campaign:bf2026' });

    db.getRows('campaigns').push({ id: 'c2', slug: 'cm2026', published: true, archived_at: null, featured_from: '2026-11-28', starts_at: '2026-11-28', ends_at: '2026-12-02', priority: 0, cta: { action: 'paywall' } });
    proOfferCampaignsCache.clear();
    vi.setSystemTime(new Date('2026-11-28T10:00:00Z'));
    const rearmed = (await (await GET_ENTITLEMENTS(req('/api/mobile/entitlements', 'GET'))).json()).data;
    expect(rearmed.proBadge).toEqual({ marker: true, offerId: 'campaign:cm2026' });
  });

  it('paywall_shown still 200 with the same body when 115 is not applied', async () => {
    missing = /paywall_last_opened_at/;
    const res = await POST_EVENT(req('/api/mobile/me/journey/events', 'POST', { event: 'paywall_shown', placement: 'feed_pro_value', automatic: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ event: 'paywall_shown', paywallAutoLastAt: NOW.toISOString() });
  });

  it('subscribers / trials: no marker; memberSince from the first purchase or trial start', async () => {
    Object.assign(db.getRows('profiles')[0], { subscription_tier: 'premium', subscription_status: 'active', subscription_platform: 'app_store' });
    db.getRows('subscription_events').push(
      { id: 'e2', user_id: USER, type: 'RENEWAL', environment: 'PRODUCTION', event_timestamp: '2026-11-01T00:00:00Z', raw: { purchased_at_ms: Date.parse('2026-11-01T00:00:00Z') } },
      { id: 'e1', user_id: USER, type: 'INITIAL_PURCHASE', environment: 'PRODUCTION', event_timestamp: '2026-10-01T09:30:00Z', raw: { purchased_at_ms: Date.parse('2026-10-01T09:30:00Z') } }
    );
    const pro = (await (await GET_ENTITLEMENTS(req('/api/mobile/entitlements', 'GET'))).json()).data;
    expect(pro.proBadge).toEqual({ marker: false, offerId: 'campaign:bf2026' });
    expect(pro.memberSince).toBe('2026-10-01T09:30:00.000Z');

    Object.assign(db.getRows('profiles')[0], { subscription_status: 'trialing', trial_started_at: '2026-09-20T12:00:00Z' });
    const trial = (await (await GET_ENTITLEMENTS(req('/api/mobile/entitlements', 'GET'))).json()).data;
    expect(trial.proBadge.marker).toBe(false);
    expect(trial.memberSince).toBe('2026-09-20T12:00:00.000Z');
  });

  it('no offer configured: marker false, offerId null; free user memberSince null', async () => {
    db.getRows('campaigns').length = 0;
    const d = (await (await GET_ENTITLEMENTS(req('/api/mobile/entitlements', 'GET'))).json()).data;
    expect(d.proBadge).toEqual({ marker: false, offerId: null });
    expect(d.memberSince).toBeNull();
  });
});

describe('onboarding save points: shipped bodies unchanged', () => {
  it('progress + plan without birth fields return exactly the previous shapes', async () => {
    const progress = (await (await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 'v2_goal', data: { goal: 'lose_weight' } }))).json()).data;
    expect(progress).toEqual({ flow: 'v2', step: 'v2_goal', data: { goal: 'lose_weight' }, updatedAt: NOW.toISOString() });
    const plan = (await (await POST_PLAN(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', heightCm: 180, weightKg: 90, targetWeightKg: 80, sex: 'male', age: 35 }))).json()).data;
    expect(plan).toEqual({ calories: 2100, proteinG: 128, waterMl: 2700, steps: 8000, basis: 'personal', assumptions: [] });
    expect(db.getRows('profiles')[0].date_of_birth).toBeUndefined();
  });
});

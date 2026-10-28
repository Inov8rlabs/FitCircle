/**
 * Shipped-client compatibility for the additive ONBOARDING_V2 fields on
 *   GET  /api/mobile/entitlements        (subscription.isTrial / trialEndsAt, gate, locked)
 *   POST /api/mobile/subscriptions/sync  (same `data`)
 *   GET  /api/mobile/onboarding/status   (shouldResume, resume)
 *
 * Decoders mirror the models the released apps ship:
 *  - iOS (FitCircle-iOS b7f837e, Core/Models/BodyComposition.swift): Codable, no key
 *    strategy. `Entitlements { tier: String, features: [String: FeatureEntitlement],
 *    limits: EntitlementLimits?, subscriptionsEnabled: Bool?, subscription:
 *    EntitlementSubscription? }`; every EntitlementSubscription field optional
 *    (String? / Bool?). Unknown keys are ignored by Codable.
 *  - Android (Fitcircle-Android 05909e5, core/model/BodyComposition.kt +
 *    features/onboarding/models/AssessmentModels.kt): kotlinx Json
 *    { ignoreUnknownKeys, coerceInputValues }.
 *
 * Also replays the same calls with migration 112 NOT applied (the new columns
 * error) — the response must stay decodable and fail open (gate 'none').
 *
 * iOS's OnboardingStatus model (snake_case `current_step: String`) has never
 * matched this endpoint's camelCase payload and the app never calls it
 * (APIClient.getOnboardingStatus has no call sites); iOS 1.2.0 adds a new model.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET as GET_STATUS } from '../../onboarding/status/route';
import { POST as POST_SYNC } from '../../subscriptions/sync/route';
import { GET as GET_ENTITLEMENTS } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authedUser: Record<string, any> = {};
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: vi.fn(async () => ({ ...authedUser })) }));

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-10T12:00:00Z');

const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const isInt = (v: any) => typeof v === 'number' && Number.isInteger(v);
const optStr = (v: any) => v == null || typeof v === 'string';
const optBool = (v: any) => v == null || typeof v === 'boolean';

/** iOS APIResponse<Entitlements>. */
function iosEntitlements(b: any): string[] {
  const p: string[] = [];
  if (typeof b?.success !== 'boolean') p.push('success');
  const d = b?.data;
  if (!d) return [...p, 'data'];
  if (typeof d.tier !== 'string') p.push('tier');
  if (!d.features || typeof d.features !== 'object') p.push('features');
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

/** Android ApiResponse<Entitlements> (coerceInputValues: null → default for non-null fields). */
function androidEntitlements(b: any): string[] {
  const p: string[] = [];
  if (b?.success !== true || b?.data == null) p.push('success && data');
  const d = b?.data ?? {};
  if (d.tier != null && typeof d.tier !== 'string') p.push('tier');
  if (d.features != null && typeof d.features !== 'object') p.push('features');
  if (!optBool(d.subscriptionsEnabled)) p.push('subscriptionsEnabled');
  const s = d.subscription;
  if (s != null) {
    for (const k of ['status', 'platform', 'productId', 'expiresAt', 'source']) if (!optStr(s[k])) p.push(`subscription.${k}`);
    if (!optBool(s.willRenew)) p.push('subscription.willRenew');
  }
  return p;
}

/** Android OnboardingStatus. */
function androidStatus(b: any): string[] {
  const p: string[] = [];
  const d = b?.data;
  if (b?.success !== true || d == null) return ['success && data'];
  if (d.currentStep != null && !isInt(d.currentStep)) p.push('currentStep');
  if (d.completedSteps != null && !(Array.isArray(d.completedSteps) && d.completedSteps.every((x: any) => typeof x === 'string'))) p.push('completedSteps');
  if (!optBool(d.hasCompletedAssessment) || !optBool(d.hasCompletedOnboarding)) p.push('has*');
  if (d.fitnessLevel != null && !['beginner', 'intermediate', 'advanced', 'expert'].includes(String(d.fitnessLevel).toLowerCase())) p.push('fitnessLevel');
  if (d.preferredWorkoutTypes != null && !Array.isArray(d.preferredWorkoutTypes)) p.push('preferredWorkoutTypes');
  return p;
}

/** The new fields' own contract (what 1.2.0 clients decode). */
function newFields(d: any): string[] {
  const p: string[] = [];
  if (!['none', 'subscription_required'].includes(d.gate)) p.push('gate');
  if (typeof d.locked !== 'boolean') p.push('locked');
  if (typeof d.subscription?.isTrial !== 'boolean') p.push('subscription.isTrial');
  if (d.subscription?.trialEndsAt != null && !ISO_TZ.test(d.subscription.trialEndsAt)) p.push('subscription.trialEndsAt');
  return p;
}

const PROFILES = {
  free: { subscription_tier: 'free', subscription_status: null, subscription_will_renew: false, onboarding_gate: 'none', trial_ends_at: null },
  trialing: {
    subscription_tier: 'premium',
    subscription_status: 'trialing',
    subscription_platform: 'app_store',
    subscription_product_id: 'com.inov8rlabs.fitcircle.pro.annual',
    subscription_expires_at: '2026-11-13T14:05:00+00:00',
    subscription_will_renew: true,
    trial_ends_at: '2026-11-13T14:05:00+00:00',
    onboarding_gate: 'subscription_required',
  },
  locked: { subscription_tier: 'free', subscription_status: 'cancelled', subscription_will_renew: false, onboarding_gate: 'subscription_required', trial_ends_at: '2026-11-01T00:00:00Z' },
} as const;

let db: FakeSupabase;
let migrationApplied = true;
const NEW_COLUMNS = /trial_|onboarding_gate|onboarding_progress|\bflow\b|\bstep\b/;

function client() {
  return {
    from(table: string) {
      const q = db.from(table) as any;
      if (migrationApplied) return q;
      const select = q.select.bind(q);
      q.select = (cols?: string, opts?: any) => {
        if (cols && NEW_COLUMNS.test(cols)) {
          const err = { data: null, error: { code: '42703', message: `column does not exist: ${cols}` } };
          const failing: any = { then: (r: any, j: any) => Promise.resolve(err).then(r, j), maybeSingle: async () => err, single: async () => err };
          for (const m of ['eq', 'in', 'is', 'order', 'limit', 'gte', 'lte', 'gt', 'lt']) failing[m] = () => failing;
          return failing;
        }
        return select(cols, opts);
      };
      return q;
    },
  };
}

function setup(state: keyof typeof PROFILES) {
  authedUser = { id: USER, created_at: NOW.toISOString() };
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'], rows: [{ id: USER, created_at: NOW.toISOString(), onboarding_completed: false, has_completed_assessment: false, onboarding_current_step: 0, fitness_level: null, preferred_workout_types: [], ...PROFILES[state] }] },
    feature_gates: { rows: [{ feature_key: 'food_ai_unlimited', required_tier: 'premium' }] },
    feature_flags: { rows: [{ name: 'subscriptions', is_enabled: true, rollout_percentage: 100 }] },
    onboarding_progress: { uniqueKey: ['user_id'], rows: [{ user_id: USER, flow: 'v2', step: 'v2_plan', data: { goal: 'lose_weight' }, updated_at: NOW.toISOString(), is_complete: false }] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(client() as any);
}

const get = (path: string, method = 'GET') => new NextRequest(`https://api.test${path}`, { method, headers: { authorization: 'Bearer t' } });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  migrationApplied = true;
});

describe.each([true, false])('migration 112 applied: %s', (applied) => {
  for (const state of Object.keys(PROFILES) as (keyof typeof PROFILES)[]) {
    it(`entitlements + sync (${state}) decode on shipped iOS and Android`, async () => {
      setup(state);
      migrationApplied = applied;
      for (const res of [await GET_ENTITLEMENTS(get('/api/mobile/entitlements')), await POST_SYNC(get('/api/mobile/subscriptions/sync', 'POST'))]) {
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe('no-store');
        const body = await res.json();
        expect(iosEntitlements(body)).toEqual([]);
        expect(androidEntitlements(body)).toEqual([]);
        expect(newFields(body.data)).toEqual([]);
        if (!applied) expect(body.data).toMatchObject({ gate: 'none', locked: false });
      }
    });
  }

  it('onboarding status decodes on shipped Android', async () => {
    setup('free');
    migrationApplied = applied;
    const body = await (await GET_STATUS(get('/api/mobile/onboarding/status'))).json();
    expect(androidStatus(body)).toEqual([]);
    expect(typeof body.data.shouldResume).toBe('boolean');
    expect(applied ? body.data.resume : null).toEqual(applied ? { flow: 'v2', step: 'v2_plan', data: { goal: 'lose_weight' }, updatedAt: NOW.toISOString() } : null);
    if (!applied) expect(body.data.shouldResume).toBe(false);
  });
});

describe('field values', () => {
  it('trialing: isTrial + trialEndsAt; locked only without Pro', async () => {
    setup('trialing');
    const t = (await (await GET_ENTITLEMENTS(get('/api/mobile/entitlements'))).json()).data;
    expect(t.subscription).toMatchObject({ status: 'trialing', isTrial: true, trialEndsAt: '2026-11-13T14:05:00+00:00', willRenew: true });
    expect(t).toMatchObject({ gate: 'subscription_required', locked: false });
    setup('locked');
    const l = (await (await GET_ENTITLEMENTS(get('/api/mobile/entitlements'))).json()).data;
    expect(l.subscription).toMatchObject({ isTrial: false, trialEndsAt: null });
    expect(l).toMatchObject({ gate: 'subscription_required', locked: true, tier: 'free' });
  });
});

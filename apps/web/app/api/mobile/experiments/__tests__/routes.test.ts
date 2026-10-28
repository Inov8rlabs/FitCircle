/**
 * /api/mobile/experiments/{assign,exposure} and the onboarding v2 routes
 * (progress, status additions, plan, gate) — contract + behaviour against an
 * in-memory Supabase.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { PATCH as PATCH_PROGRESS } from '../../onboarding/progress/route';
import { POST as POST_PLAN } from '../../onboarding/plan/route';
import { POST as POST_GATE } from '../../onboarding/gate/route';
import { GET as GET_STATUS } from '../../onboarding/status/route';
import { POST as POST_COMPLETE } from '../../onboarding/complete/route';
import { GET as GET_ENTITLEMENTS } from '../../entitlements/route';
import { POST as POST_ASSIGN } from '../assign/route';
import { POST as POST_EXPOSURE } from '../exposure/route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: { onActivity: vi.fn(async () => undefined) } }));
vi.mock('@/lib/services/mobile-api-service', () => ({ MobileAPIService: { getUserProfileWithStats: vi.fn(async () => ({})) } }));
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return { ...authedUser };
  }),
}));

const NOW = new Date('2026-11-10T12:00:00Z');
const USER = 'a1b2c3d4-0000-4000-8000-000000000001';
const DEMO = '47476150-a984-4431-a89a-7cc8085adfe6';
const API = 'https://api.test';

const ARMS = [
  { key: 'control', name: 'Current onboarding', weight: 20, payload: { flow: 'v1', paywall: 'none' } },
  { key: 'variantA', name: 'Tour + hard paywall', weight: 40, payload: { flow: 'v2', paywall: 'hard' } },
  { key: 'variantB', name: 'Tour + skippable paywall', weight: 40, payload: { flow: 'v2', paywall: 'soft' } },
];
const EXPERIMENT = {
  key: 'onboarding_v2',
  name: 'Onboarding v2',
  description: null,
  status: 'running',
  salt: 'salt-1',
  arms: ARMS,
  traffic_pct: 100,
  audience: { platforms: ['ios', 'android'], minAppVersion: '1.2.0', newUsersOnly: true, excludeUserIds: [DEMO] },
  fallback_arm: 'control',
  winner_arm: null,
};

let db: FakeSupabase;
function profile(over: Record<string, any> = {}) {
  return {
    id: USER,
    email: 'new@example.com',
    created_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    onboarding_completed: false,
    subscription_tier: 'free',
    subscription_status: null,
    country_code: null,
    onboarding_gate: 'none',
    onboarding_paywall_at: null,
    has_completed_assessment: false,
    total_xp: 0,
    current_level: 1,
    fitness_level: null,
    preferred_workout_types: [],
    onboarding_current_step: 0,
    height_cm: null,
    weight_kg: null,
    date_of_birth: null,
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new FakeSupabase({
    experiments: { uniqueKey: ['key'], rows: [{ ...EXPERIMENT }] },
    experiment_assignments: { uniqueKey: ['experiment_key', 'user_id'] },
    experiment_overrides: { uniqueKey: ['experiment_key', 'user_id'] },
    experiment_audit_log: {},
    profiles: { uniqueKey: ['id'], rows: [profile()] },
    complimentary_grants: {},
    onboarding_progress: { uniqueKey: ['user_id'] },
    user_achievements: { uniqueKey: ['user_id', 'achievement_name'] },
    feature_gates: {},
    feature_flags: { rows: [{ name: 'subscriptions', is_enabled: true, rollout_percentage: 100 }] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  authedUser = profile();
});
afterEach(() => vi.useRealTimers());

const req = (path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`${API}${path}`, {
    method: opts.method ?? 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json', 'x-app-platform': 'ios', 'x-app-version': '1.2.0', ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
const assign = async (headers?: Record<string, string>) => {
  const res = await POST_ASSIGN(req('/api/mobile/experiments/assign', { body: { keys: ['onboarding_v2'] }, headers }));
  return { res, body: await res.json() };
};
const assignments = () => db.getRows('experiment_assignments');

describe('POST /api/mobile/experiments/assign', () => {
  it('returns the envelope with {arm, payload, enrolled}, no-store, and persists a sticky bucket row', async () => {
    const { res, body } = await assign();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.success).toBe(true);
    const a = body.data.assignments.onboarding_v2;
    expect(['control', 'variantA', 'variantB']).toContain(a.arm);
    expect(a.enrolled).toBe(true);
    expect(a.payload).toEqual(ARMS.find((x) => x.key === a.arm)!.payload);
    expect(a.name).toBe(ARMS.find((x) => x.key === a.arm)!.name);
    expect(a.reason).toBe('bucket');
    expect(Object.keys(a).sort()).toEqual(['arm', 'enrolled', 'name', 'payload', 'reason']);
    expect(assignments()).toHaveLength(1);
    expect(assignments()[0]).toMatchObject({ user_id: USER, arm: a.arm, reason: 'bucket', platform: 'ios', app_version: '1.2.0' });
    expect(assignments()[0].first_exposed_at ?? null).toBeNull();

    // Idempotent + sticky even after weights change and the account ages.
    db.getRows('experiments')[0].arms = [{ key: 'control', name: 'Current onboarding', weight: 100, payload: {} }, { key: 'variantA', name: 'Tour + hard paywall', weight: 0, payload: {} }, { key: 'variantB', name: 'Tour + skippable paywall', weight: 0, payload: {} }];
    authedUser = profile({ created_at: '2026-01-01T00:00:00Z' });
    const again = await assign();
    expect(again.body.data.assignments.onboarding_v2.arm).toBe(a.arm);
    expect(assignments()).toHaveLength(1);
  });

  it('ineligible (old app / web / old account / demo / complimentary) → control, enrolled false, nothing persisted', async () => {
    expect((await assign({ 'x-app-version': '1.1.9' })).body.data.assignments.onboarding_v2).toEqual({
      arm: 'control',
      payload: ARMS[0].payload,
      enrolled: false,
      name: ARMS[0].name,
      reason: 'fallback',
    });
    expect((await assign({ 'x-app-platform': 'web' })).body.data.assignments.onboarding_v2.enrolled).toBe(false);
    authedUser = profile({ created_at: '2026-01-01T00:00:00Z' });
    expect((await assign()).body.data.assignments.onboarding_v2.arm).toBe('control');
    authedUser = profile({ id: DEMO });
    expect((await assign()).body.data.assignments.onboarding_v2).toMatchObject({ arm: 'control', enrolled: false });
    authedUser = profile();
    db.seed('complimentary_grants', [{ id: 'g1', user_id: USER, granted_by: 'admin', revoked_at: null, expires_at: null, created_at: NOW.toISOString() }]);
    expect((await assign()).body.data.assignments.onboarding_v2.enrolled).toBe(false);
    expect(assignments()).toHaveLength(0);
  });

  it('X-Platform (Android) is accepted as the platform header', async () => {
    const res = await POST_ASSIGN(
      new NextRequest(`${API}/api/mobile/experiments/assign`, {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'x-platform': 'android', 'x-app-version': '1.2.0' },
        body: JSON.stringify({ keys: ['onboarding_v2'] }),
      })
    );
    expect((await res.json()).data.assignments.onboarding_v2.enrolled).toBe(true);
  });

  it('draft experiment → fallback persisted; a later start does not move the user', async () => {
    db.getRows('experiments')[0].status = 'draft';
    expect((await assign()).body.data.assignments.onboarding_v2).toMatchObject({ arm: 'control', enrolled: false, reason: 'fallback' });
    expect(assignments()[0]).toMatchObject({ reason: 'fallback', arm: 'control' });
    db.getRows('experiments')[0].status = 'running';
    expect((await assign()).body.data.assignments.onboarding_v2).toMatchObject({ arm: 'control', enrolled: false });
  });

  it('override wins and is persisted with reason override (enrolled false)', async () => {
    db.seed('experiment_overrides', [{ experiment_key: 'onboarding_v2', user_id: USER, arm: 'variantB' }]);
    expect((await assign({ 'x-app-platform': 'web' })).body.data.assignments.onboarding_v2).toMatchObject({ arm: 'variantB', enrolled: false, reason: 'override' });
    expect(assignments()[0]).toMatchObject({ reason: 'override', arm: 'variantB' });
  });

  it('unknown keys are omitted; bad bodies are 400; anonymous is 401', async () => {
    const res = await POST_ASSIGN(req('/api/mobile/experiments/assign', { body: { keys: ['nope'] } }));
    expect((await res.json()).data.assignments).toEqual({});
    const bad = await POST_ASSIGN(req('/api/mobile/experiments/assign', { body: { keys: [] } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');
    authedUser = null;
    const anon = await POST_ASSIGN(req('/api/mobile/experiments/assign', { body: { keys: ['onboarding_v2'] } }));
    expect(anon.status).toBe(401);
    expect(anon.headers.get('cache-control')).toBe('no-store');
  });
});

describe('assign response vs the 1.2.0 client decoders (FitCircle-iOS-onboarding ExperimentAssignmentDTO, Fitcircle-Android-onboarding ExperimentAssignmentDto)', () => {
  /** Both: arm String, payload object?, enrolled Bool, name String?, reason String? (unknown keys ignored). */
  const decodes = (a: any) =>
    typeof a.arm === 'string' &&
    (a.payload == null || (typeof a.payload === 'object' && !Array.isArray(a.payload))) &&
    typeof a.enrolled === 'boolean' &&
    (a.name == null || typeof a.name === 'string') &&
    (a.reason == null || typeof a.reason === 'string');

  it('every reason path decodes', async () => {
    expect(decodes((await assign()).body.data.assignments.onboarding_v2)).toBe(true); // bucket
    authedUser = profile({ id: 'a1b2c3d4-0000-4000-8000-000000000002', created_at: '2026-01-01T00:00:00Z' });
    expect(decodes((await assign()).body.data.assignments.onboarding_v2)).toBe(true); // fallback (ineligible)
    db.seed('experiment_overrides', [{ experiment_key: 'onboarding_v2', user_id: 'a1b2c3d4-0000-4000-8000-000000000002', arm: 'variantA' }]);
    const o = (await assign()).body.data.assignments.onboarding_v2;
    expect(decodes(o)).toBe(true);
    expect(o).toMatchObject({ arm: 'variantA', name: 'Tour + hard paywall', reason: 'override', enrolled: false });
  });
});

describe('POST /api/mobile/experiments/exposure', () => {
  it('sets first_exposed_at once, only for the persisted arm', async () => {
    const arm = (await assign()).body.data.assignments.onboarding_v2.arm as string;
    const other = arm === 'control' ? 'variantB' : 'control';
    const send = (a: string) => POST_EXPOSURE(req('/api/mobile/experiments/exposure', { body: { key: 'onboarding_v2', arm: a, surface: 'v2_welcome' } }));

    const wrong = await send(other);
    expect(await wrong.json()).toMatchObject({ success: true, data: { ok: true } });
    expect(assignments()[0].first_exposed_at).toBeUndefined();

    await send(arm);
    const first = assignments()[0].first_exposed_at;
    expect(first).toBe(NOW.toISOString());
    expect(assignments()[0].exposure_surface).toBe('v2_welcome');
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await send(arm);
    expect(assignments()[0].first_exposed_at).toBe(first);
  });

  it('no assignment → still ok', async () => {
    const res = await POST_EXPOSURE(req('/api/mobile/experiments/exposure', { body: { key: 'onboarding_v2', arm: 'control', surface: 'v1_welcome' } }));
    expect((await res.json()).data).toEqual({ ok: true });
  });
});

describe('onboarding progress + status resume (R2)', () => {
  it('PATCH upserts flow/step/data and records profiles.onboarding_flow; omitted data is kept', async () => {
    const res = await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', { method: 'PATCH', body: { flow: 'v2', step: 'v2_goal', data: { goal: 'lose_weight' } } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).data).toMatchObject({ flow: 'v2', step: 'v2_goal', data: { goal: 'lose_weight' }, updatedAt: NOW.toISOString() });
    await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', { method: 'PATCH', body: { flow: 'v2', step: 'v2_about_you' } }));
    expect(db.getRows('onboarding_progress')).toHaveLength(1);
    expect(db.getRows('onboarding_progress')[0]).toMatchObject({ step: 'v2_about_you', data: { goal: 'lose_weight' } });
    expect(db.getRows('profiles')[0].onboarding_flow).toBe('v2');
  });

  it('rejects bad flow / oversized data', async () => {
    expect((await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', { method: 'PATCH', body: { flow: 'v4', step: 'x' } }))).status).toBe(400);
    const big = { blob: 'x'.repeat(20_000) };
    expect((await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', { method: 'PATCH', body: { flow: 'v1', step: 'x', data: big } }))).status).toBe(400);
  });

  it('GET status keeps the legacy fields and adds shouldResume + resume', async () => {
    const empty = await (await GET_STATUS(req('/api/mobile/onboarding/status', { method: 'GET' }))).json();
    // No PATCH /progress row yet → never resume (even though not completed and < 30 days).
    expect(empty.data).toMatchObject({ hasCompletedOnboarding: false, currentStep: 0, nextStep: 'profile_setup', shouldResume: false, resume: null });
    for (const k of ['hasCompletedAssessment', 'hasCompletedOnboarding', 'currentStep', 'completedSteps', 'nextStep', 'fitnessLevel', 'preferredWorkoutTypes']) expect(empty.data).toHaveProperty(k);

    await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', { method: 'PATCH', body: { flow: 'v1', step: 'goals', data: { a: 1 } } }));
    const res = await GET_STATUS(req('/api/mobile/onboarding/status', { method: 'GET' }));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).data).toMatchObject({ shouldResume: true, resume: { flow: 'v1', step: 'goals', data: { a: 1 }, updatedAt: NOW.toISOString() } });
  });

  it('legacy "not completed" accounts with no v2 progress row (old Android back-button bug) never resume', async () => {
    // Pre-112 row: written by the old OnboardingService, flow/step null.
    db.seed('onboarding_progress', [{ user_id: USER, current_step: 3, is_complete: false, flow: null, step: null, data: {} }]);
    db.getRows('profiles')[0].created_at = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
    const body = await (await GET_STATUS(req('/api/mobile/onboarding/status', { method: 'GET' }))).json();
    expect(body.data).toMatchObject({ hasCompletedOnboarding: false, shouldResume: false, resume: null });
    // And with no row at all.
    db.getRows('onboarding_progress').length = 0;
    expect((await (await GET_STATUS(req('/api/mobile/onboarding/status', { method: 'GET' }))).json()).data).toMatchObject({ shouldResume: false, resume: null });
  });

  it('POST /onboarding/complete is safe to call twice (second call awards nothing)', async () => {
    const first = await (await POST_COMPLETE(req('/api/mobile/onboarding/complete', { body: {} }))).json();
    expect(first).toMatchObject({ success: true, data: { success: true, xpAwarded: 250 } });
    const second = await (await POST_COMPLETE(req('/api/mobile/onboarding/complete', { body: {} }))).json();
    expect(second).toMatchObject({ success: true, data: { success: true, xpAwarded: 0 } });
    expect(db.getRows('profiles')[0]).toMatchObject({ onboarding_completed: true, total_xp: 250 });
    expect(db.getRows('user_achievements')).toHaveLength(1);
  });

  it('accounts ≥ 30 days old and completed onboarding never resume', async () => {
    await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', { method: 'PATCH', body: { flow: 'v2', step: 'v2_goal' } }));
    db.getRows('profiles')[0].created_at = new Date(NOW.getTime() - 31 * 86_400_000).toISOString();
    expect((await (await GET_STATUS(req('/api/mobile/onboarding/status', { method: 'GET' }))).json()).data.shouldResume).toBe(false);
    db.getRows('profiles')[0].created_at = NOW.toISOString();
    db.getRows('profiles')[0].onboarding_completed = true;
    expect((await (await GET_STATUS(req('/api/mobile/onboarding/status', { method: 'GET' }))).json()).data.shouldResume).toBe(false);
  });
});

describe('POST /api/mobile/onboarding/plan', () => {
  it('computes from the body, falling back to the saved profile', async () => {
    const res = await POST_PLAN(req('/api/mobile/onboarding/plan', { body: { goal: 'lose_weight', heightCm: 180, weightKg: 90, targetWeightKg: 80, sex: 'male', age: 35 } }));
    expect((await res.json()).data).toEqual({ calories: 2100, proteinG: 128, waterMl: 2700, steps: 8000, basis: 'personal', assumptions: [] });
    authedUser = profile({ height_cm: 170, weight_kg: '70.00', date_of_birth: '1996-11-10' });
    const fromProfile = (await (await POST_PLAN(req('/api/mobile/onboarding/plan', { body: { goal: 'build_habits' } }))).json()).data;
    expect(fromProfile).toMatchObject({ basis: 'personal', calories: 2070, assumptions: ['sex_neutral'] });
    const generic = (await (await POST_PLAN(req('/api/mobile/onboarding/plan', { body: { goal: 'eat_healthier' } }))).json()).data;
    expect(generic.basis).toBe('personal');
    authedUser = profile();
    expect((await (await POST_PLAN(req('/api/mobile/onboarding/plan', { body: { goal: 'eat_healthier' } }))).json()).data.basis).toBe('default');
    expect((await POST_PLAN(req('/api/mobile/onboarding/plan', { body: { heightCm: 170 } }))).status).toBe(400);
  });
});

describe('POST /api/mobile/onboarding/gate + entitlements gate', () => {
  const setArm = (arm: string) =>
    db.seed('experiment_assignments', [{ experiment_key: 'onboarding_v2', user_id: USER, arm, reason: 'bucket', assigned_at: NOW.toISOString() }]);
  const gate = async () => (await (await POST_GATE(req('/api/mobile/onboarding/gate', { body: { reached: true } }))).json()).data;
  const entitlements = async () => (await (await GET_ENTITLEMENTS(req('/api/mobile/entitlements', { method: 'GET' }))).json()).data;

  it('variantA → subscription_required; entitlements report gate + locked until Pro', async () => {
    setArm('variantA');
    expect(await gate()).toEqual({ gate: 'subscription_required' });
    expect(db.getRows('profiles')[0]).toMatchObject({ onboarding_gate: 'subscription_required', onboarding_paywall_at: NOW.toISOString() });
    expect(await entitlements()).toMatchObject({ gate: 'subscription_required', locked: true });
    // Subscribing unlocks; a lapse re-locks (gate is never cleared by the store).
    db.getRows('profiles')[0].subscription_tier = 'premium';
    expect(await entitlements()).toMatchObject({ gate: 'subscription_required', locked: false });
    db.getRows('profiles')[0].subscription_tier = 'free';
    expect((await entitlements()).locked).toBe(true);
    // Subscriptions kill switch off → never locked.
    db.getRows('feature_flags')[0].is_enabled = false;
    expect((await entitlements()).locked).toBe(false);
  });

  it('variantB / control / unassigned → gate stays none (paywall view still recorded)', async () => {
    setArm('variantB');
    expect(await gate()).toEqual({ gate: 'none' });
    expect(db.getRows('profiles')[0]).toMatchObject({ onboarding_gate: 'none', onboarding_paywall_at: NOW.toISOString() });
    expect(await entitlements()).toMatchObject({ gate: 'none', locked: false });
  });

  it('the gate follows the arm payload (paywall "hard"), never the arm key', async () => {
    db.getRows('experiments')[0].arms = [
      { key: 'control', name: 'C', weight: 20, payload: { flow: 'v1' } },
      { key: 'variantA', name: 'Soft now', weight: 40, payload: { flow: 'v2', paywall: 'soft' } },
      { key: 'variantB', name: 'Hard now', weight: 40, payload: { flow: 'v2', paywall: 'hard' } },
    ];
    setArm('variantA');
    expect(await gate()).toEqual({ gate: 'none' });
    db.getRows('experiment_assignments')[0].arm = 'variantB';
    expect(await gate()).toEqual({ gate: 'subscription_required' });
  });

  it('a paused (released) experiment never sets the gate', async () => {
    setArm('variantA');
    db.getRows('experiments')[0].status = 'paused';
    expect(await gate()).toEqual({ gate: 'none' });
  });

  it('body must be {reached:true}', async () => {
    expect((await POST_GATE(req('/api/mobile/onboarding/gate', { body: {} }))).status).toBe(400);
  });
});

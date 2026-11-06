/**
 * GET / POST /api/mobile/profile/completion (docs/PROFILE_COMPLETION_CARD_SPEC.md):
 * each key lands in the store the rest of the app reads, the response is the
 * new status, validation, and the untouched onboarding plan refresh.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../../__tests__/helpers/fake-supabase';
import { computePlan } from '../../../../../lib/onboarding/plan';
import { planRequestFrom, resolveAnswers } from '../../../../../lib/profile-completion/model';
import { GET, POST } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authed = true;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authed) throw new Error('Unauthorized');
    return { ...db.getRows('profiles')[0] };
  }),
}));
// The weigh-in goes through the same service call as POST /api/mobile/tracking/daily.
const upsertDailyTracking = vi.fn(async (userId: string, date: string, data: { weight_kg?: number }) => {
  db.seed('daily_tracking', [{ user_id: userId, tracking_date: date, weight_kg: data.weight_kg }]);
  return { id: 't1' };
});
vi.mock('@/lib/services/mobile-api-service', () => ({ MobileAPIService: { upsertDailyTracking: (...a: any[]) => (upsertDailyTracking as any)(...a) } }));
const updateGoalCompletion = vi.fn(async () => undefined);
vi.mock('@/lib/services/daily-goals', () => ({ DailyGoalService: { updateGoalCompletion: (...a: any[]) => (updateGoalCompletion as any)(...a) } }));

const USER = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-11-03T03:30:00Z'); // 22:30 Nov 2 in New York
let db: FakeSupabase;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest('https://api.test/api/mobile/profile/completion', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );
const get = () => GET(new NextRequest('https://api.test/api/mobile/profile/completion', { headers: { authorization: 'Bearer t' } }));
const profile = () => db.getRows('profiles')[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  authed = true;
  upsertDailyTracking.mockClear();
  updateGoalCompletion.mockClear();
  db = new FakeSupabase({
    profiles: {
      uniqueKey: ['id'],
      rows: [
        {
          id: USER,
          timezone: 'America/New_York',
          onboarding_completed: true,
          height_cm: null,
          weight_kg: null,
          gender: null,
          date_of_birth: null,
          goals: [],
          preferences: { display: { units: 'imperial' } },
        },
      ],
    },
    onboarding_progress: { uniqueKey: ['user_id'], rows: [{ user_id: USER, data: { goal: 'lose_weight', activity: 'active' } }] }, // Android blob
    daily_tracking: { uniqueKey: ['user_id', 'tracking_date'] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

describe('GET /api/mobile/profile/completion', () => {
  it('the status, same shape as the card props; no-store envelope', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      success: true,
      error: null,
      data: { percent: 29, answered: 2, total: 7, remaining: ['height', 'weight', 'goal_weight', 'birth_year', 'sex'], units: 'imperial', hints: {}, goal: 'lose_weight' },
    });
  });

  it('401 without auth', async () => {
    authed = false;
    expect((await get()).status).toBe(401);
  });
});

describe('POST /api/mobile/profile/completion — where each answer goes', () => {
  it('height → profiles.height_cm (rounded); the response is the new status with the goal-weight hint', async () => {
    const res = await post({ key: 'height', value: 172.72, source: 'home_card' });
    expect(res.status).toBe(200);
    expect(profile().height_cm).toBe(173);
    expect((await res.json()).data).toEqual({
      percent: 43,
      answered: 3,
      total: 7,
      remaining: ['weight', 'goal_weight', 'birth_year', 'sex'],
      units: 'imperial',
      hints: { goal_weight: { healthy_min_kg: 55.4, healthy_max_kg: 74.5 } },
      goal: 'lose_weight',
      key: 'height',
      targets_updated: [],
    });
  });

  it("weight → today's weigh-in in the user's day (client timezone first) + profiles.weight_kg", async () => {
    let res = await post({ key: 'weight', value: 81.6466 });
    expect(upsertDailyTracking).toHaveBeenCalledWith(USER, '2026-11-02', { weight_kg: 81.6466 });
    expect(updateGoalCompletion).toHaveBeenCalledWith(USER, '2026-11-02', { weight_kg: 81.6466 });
    expect(profile().weight_kg).toBe(81.6466);
    expect((await res.json()).data.remaining).not.toContain('weight');

    res = await post({ key: 'weight', value: 80 }, { 'x-client-timezone': 'Asia/Kolkata' });
    expect(res.status).toBe(200);
    expect(upsertDailyTracking).toHaveBeenLastCalledWith(USER, '2026-11-03', { weight_kg: 80 });
  });

  it('goal_weight → the vitals weight goal (starting weight = current weight when unset)', async () => {
    db.seed('daily_tracking', [{ user_id: USER, tracking_date: '2026-11-01', weight_kg: 90 }]);
    await post({ key: 'goal_weight', value: 75 });
    expect(profile().goals).toEqual([expect.objectContaining({ type: 'weight', target_weight_kg: 75, starting_weight_kg: 90 })]);
    // A later change keeps the existing starting weight.
    await post({ key: 'goal_weight', value: 72 });
    expect(profile().goals).toEqual([expect.objectContaining({ type: 'weight', target_weight_kg: 72, starting_weight_kg: 90 })]);
  });

  it('birth_year → date_of_birth estimate (never over a full date); sex → gender ("rather not say" counts)', async () => {
    await post({ key: 'birth_year', value: 1991 });
    expect(profile().date_of_birth).toBe('1991-07-01');
    expect(profile().preferences.date_of_birth_estimate).toEqual({ from: 'birth_year', date: '1991-07-01' });
    profile().date_of_birth = '1991-03-14';
    delete profile().preferences.date_of_birth_estimate;
    await post({ key: 'birth_year', value: 1985 });
    expect(profile().date_of_birth).toBe('1991-03-14');

    const res = await post({ key: 'sex', value: 'prefer_not_to_say' });
    expect(profile().gender).toBe('prefer_not_to_say');
    expect((await res.json()).data.remaining).not.toContain('sex');
  });

  it('goal / activity → preferences.about_you (other preferences kept); goal "stay_active" drops goal_weight', async () => {
    let body = await (await post({ key: 'goal', value: 'stay_active' })).json();
    expect(profile().preferences).toEqual({ display: { units: 'imperial' }, about_you: { goal: 'stay_active', updated_at: NOW.toISOString() } });
    expect(body.data).toMatchObject({ total: 6, remaining: ['height', 'weight', 'birth_year', 'sex'], goal: 'stay_active' });
    body = await (await post({ key: 'activity', value: 'sedentary' })).json();
    expect(profile().preferences.about_you).toMatchObject({ goal: 'stay_active', activity: 'sedentary' });
    expect(body.data.answered).toBe(2);
  });

  it('400 VALIDATION_ERROR with issues for bad input; nothing written', async () => {
    for (const bad of [{ key: 'height', value: 400 }, { key: 'nope', value: 1 }, { key: 'sex', value: 'x' }, '{not json']) {
      const res = await post(bad);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.data.issues)).toBe(true);
    }
    expect(profile()).toMatchObject({ height_cm: null, gender: null, date_of_birth: null });
  });

  it('under 18 → 400 AGE_REQUIREMENT (neutral message); nothing written', async () => {
    const res = await post({ key: 'birth_year', value: 2020 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('AGE_REQUIREMENT');
    expect(body.error.message).toMatch(/18 and over/);
    expect(profile()).toMatchObject({ date_of_birth: null });
  });
});

describe('POST — refreshes the untouched onboarding plan', () => {
  const planFor = () => computePlan(planRequestFrom(resolveAnswers({ profile: profile(), onboardingData: db.getRows('onboarding_progress')[0].data, latestWeightKg: (db.getRows('daily_tracking')[0]?.weight_kg as number) ?? null }), NOW));
  const saveTargets = (p: ReturnType<typeof computePlan>, edit: Partial<Record<'calories' | 'proteinG', number>> = {}) => {
    Object.assign(profile(), {
      preferences: {
        ...profile().preferences,
        nutrition: { daily_calorie_target: edit.calories ?? p.calories, daily_protein_g_target: edit.proteinG ?? p.proteinG, origin: 'onboarding_plan', updated_at: '2026-11-01T00:00:00Z' },
        hydration: { daily_water_ml_target: p.waterMl },
      },
      goals: [{ type: 'steps', daily_steps_target: p.steps }],
    });
  };

  it('height + weight turn the reference-body plan into a personal one; adjusted values stay', async () => {
    const reference = planFor();
    saveTargets(reference, { proteinG: reference.proteinG + 5 }); // protein was adjusted in onboarding
    await post({ key: 'height', value: 160 });
    const body = await (await post({ key: 'weight', value: 95 })).json();
    const personal = planFor();
    expect(body.data.targets_updated).toEqual(['calories', 'waterMl']);
    expect(profile().preferences.nutrition).toMatchObject({ daily_calorie_target: personal.calories, daily_protein_g_target: reference.proteinG + 5, origin: 'onboarding_plan' });
    expect(profile().preferences.hydration.daily_water_ml_target).toBe(personal.waterMl);
  });

  it('targets set in Settings are never touched', async () => {
    saveTargets(planFor());
    profile().preferences.nutrition.origin = 'settings';
    const before = JSON.stringify(profile().preferences.nutrition);
    await post({ key: 'height', value: 160 });
    const body = await (await post({ key: 'weight', value: 95 })).json();
    expect(body.data.targets_updated).toEqual([]);
    expect(JSON.stringify(profile().preferences.nutrition)).toBe(before);
  });
});

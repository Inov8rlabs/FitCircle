/**
 * GET / PUT / PATCH /api/mobile/targets (docs/USER_TARGETS_CONTRACT.md §2) and
 * the server consumers that now read the saved targets: plate score (goal-fit
 * target) and the vitals water goal.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { PlateScoreService } from '../../../../lib/services/plate-score-service';
import { VitalsService } from '../../../../lib/services/vitals-service';
import { GET, PATCH, PUT } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authed = true;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authed) throw new Error('Unauthorized');
    return { ...db.getRows('profiles')[0] };
  }),
}));

const USER = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-28T12:00:00Z');
let db: FakeSupabase;

const call = (fn: (r: NextRequest) => Promise<Response>, method: string, body?: unknown) =>
  fn(
    new NextRequest('https://api.test/api/mobile/targets', {
      method,
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  authed = true;
  db = new FakeSupabase({
    profiles: {
      uniqueKey: ['id'],
      rows: [
        {
          id: USER,
          persona: null,
          fitness_level: null,
          timezone: 'UTC',
          preferences: { notifications: { push: false }, display: { units: 'imperial' } },
          goals: [{ type: 'weight', target_weight_kg: 80, starting_weight_kg: 90 }],
        },
      ],
    },
    plate_scores: { uniqueKey: ['user_id', 'score_date'] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

describe('GET /api/mobile/targets', () => {
  it('defaults when nothing is saved; no-store envelope', async () => {
    const res = await call(GET, 'GET');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, error: null });
    expect(body.data).toEqual({
      calories: 2000,
      proteinG: null,
      carbsG: null,
      fatG: null,
      waterMl: 2000,
      steps: 10000,
      sources: { calories: 'default', proteinG: 'none', carbsG: 'none', fatG: 'none', waterMl: 'default', steps: 'default' },
      origin: null,
      updatedAt: null,
    });
  });

  it('401 without auth', async () => {
    authed = false;
    const res = await call(GET, 'GET');
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });
});

describe('PUT / PATCH /api/mobile/targets', () => {
  it('saves the accepted onboarding plan and returns the view', async () => {
    const res = await call(PUT, 'PUT', { calories: 1850, proteinG: 128, waterMl: 2700, steps: 8000, origin: 'onboarding_plan' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      calories: 1850,
      proteinG: 128,
      waterMl: 2700,
      steps: 8000,
      origin: 'onboarding_plan',
      updatedAt: NOW.toISOString(),
      sources: { calories: 'user', proteinG: 'user', carbsG: 'none', fatG: 'none', waterMl: 'user', steps: 'user' },
    });
    const row = db.getRows('profiles')[0];
    expect(row.preferences).toMatchObject({
      notifications: { push: false },
      display: { units: 'imperial' },
      hydration: { daily_water_ml_target: 2700 },
      nutrition: { daily_calorie_target: 1850, daily_protein_g_target: 128 },
    });
    expect(row.goals).toEqual([
      { type: 'weight', target_weight_kg: 80, starting_weight_kg: 90 },
      { type: 'steps', target_weight_kg: null, starting_weight_kg: null, daily_steps_target: 8000 },
    ]);
    // GET reads the same values back.
    expect((await (await call(GET, 'GET')).json()).data).toMatchObject({ calories: 1850, proteinG: 128, waterMl: 2700, steps: 8000 });
  });

  it('PATCH is partial; null reverts a target to its default', async () => {
    await call(PUT, 'PUT', { calories: 1850, proteinG: 128, carbsG: 200, fatG: 60 });
    const res = await call(PATCH, 'PATCH', { calories: null, fatG: 70 });
    expect((await res.json()).data).toMatchObject({
      calories: 2000,
      proteinG: 128,
      carbsG: 200,
      fatG: 70,
      sources: { calories: 'default', proteinG: 'user', carbsG: 'user', fatG: 'user' },
    });
  });

  it('400 VALIDATION_ERROR with issues for bad input; nothing written', async () => {
    for (const body of [{}, { calories: 500 }, { proteinG: 501 }, { steps: 'many' }, { waterMl: 50 }]) {
      const res = await call(PUT, 'PUT', body);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(json.data.issues)).toBe(true);
    }
    expect(db.getRows('profiles')[0].preferences).not.toHaveProperty('nutrition');
  });
});

describe('server consumers read the saved targets', () => {
  it('plate score goal-fit uses the user calorie target (challenge > user > default)', async () => {
    const before = await PlateScoreService.computeForDay(USER, '2026-10-28');
    expect(before.calorieTarget).toBe(2000);
    expect(before.breakdown.basis).toMatchObject({ targetSource: 'default', usedChallengeTarget: false, calorieTarget: 2000 });

    await call(PUT, 'PUT', { calories: 1650 });
    db.seed('food_log_entries', [
      { user_id: USER, entry_date: '2026-10-28', meal_type: 'breakfast', calories: 550, protein_g: 35, carbs_g: 60, fat_g: 18, deleted_at: null },
      { user_id: USER, entry_date: '2026-10-28', meal_type: 'lunch', calories: 550, protein_g: 35, carbs_g: 60, fat_g: 18, deleted_at: null },
      { user_id: USER, entry_date: '2026-10-28', meal_type: 'dinner', calories: 550, protein_g: 35, carbs_g: 60, fat_g: 18, deleted_at: null },
    ]);
    const after = await PlateScoreService.computeForDay(USER, '2026-10-28');
    expect(after.calorieTarget).toBe(1650);
    expect(after.breakdown.basis).toMatchObject({ targetSource: 'user', usedChallengeTarget: false, calorieTarget: 1650 });
    expect(after.components.goalFit).toBe(100); // 1650 eaten vs 1650 target
    expect(after.breakdown.notes).toContain("You're right in line with your daily target.");

    // Athletes: the user's own target is not persona-adjusted.
    db.getRows('profiles')[0].fitness_level = 'athlete';
    expect((await PlateScoreService.computeForDay(USER, '2026-10-28')).calorieTarget).toBe(1650);
  });

  it('vitals water goal follows the saved water target', async () => {
    await call(PUT, 'PUT', { waterMl: 2700 });
    const summary = await VitalsService.getSummary(USER, { days: 1, timezone: 'UTC' });
    expect(summary.water).toMatchObject({ goal_ml: 2700, goal_source: 'user' });
  });
});

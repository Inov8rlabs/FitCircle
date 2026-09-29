import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Null tolerance + readable validation messages on
 * PUT /api/mobile/profile/goals, PUT /api/mobile/profile/settings and
 * POST /api/mobile/onboarding/assessment.
 */
const state = {
  goals: [] as any[],
  settingsWrites: [] as Array<Record<string, any>>,
  assessments: [] as Array<Record<string, any>>,
};

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'u1', email: 'a@b.com' }),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_req: unknown, res: unknown) => res,
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    updateUserGoals: async (_userId: string, goals: any[]) => {
      state.goals = goals;
      return { goals };
    },
  },
}));
vi.mock('@/lib/services/assessment-service', () => ({
  AssessmentService: {
    submitAssessment: async (_userId: string, responses: Record<string, any>) => {
      state.assessments.push(responses);
      return { fitnessLevel: 'beginner', timeCommitment: '30-60', preferredWorkoutTypes: responses.preferred_workouts };
    },
  },
}));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      update: (patch: Record<string, any>) => ({
        eq: () => ({
          select: () => ({
            single: async () => {
              state.settingsWrites.push(patch);
              return { data: { height_cm: null, weight_kg: null, date_of_birth: null, timezone: 'UTC', fitness_level: null, ...patch }, error: null };
            },
          }),
        }),
      }),
    }),
  }),
}));

import { POST as assessment } from '../../onboarding/assessment/route';
import { PUT as goals } from '../goals/route';
import { PUT as settings } from '../settings/route';

const send = (handler: (request: any) => Promise<Response>, method: string, body: unknown) =>
  handler(
    new Request('http://localhost/api/mobile/x', {
      method,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
    })
  );

beforeEach(() => {
  state.goals = [];
  state.settingsWrites = [];
  state.assessments = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('PUT /api/mobile/profile/goals', () => {
  it('old request shape works; null stays null where the schema accepts it', async () => {
    const body = {
      goals: [
        { type: 'weight', target_weight_kg: 70, starting_weight_kg: 80, daily_steps_target: null },
        { type: 'steps', daily_steps_target: 9000 },
      ],
    };
    const res = await send(goals, 'PUT', body);
    expect(res.status).toBe(200);
    expect(state.goals).toEqual(body.goals);
    expect(await res.json()).toEqual({ success: true, goals: body.goals });
  });

  it('validation error: existing keys kept, message says what is wrong', async () => {
    const res = await send(goals, 'PUT', { goals: [{ type: 'hydration' }] });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation error');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.message).toMatch(/^goals\.0\.type: /);
  });
});

describe('PUT /api/mobile/profile/settings', () => {
  it('old request shape works', async () => {
    const res = await send(settings, 'PUT', { height_cm: 178, weight_kg: 74.5, fitness_level: 'advanced' });
    expect(res.status).toBe(200);
    expect(state.settingsWrites[0]).toMatchObject({ height_cm: 178, weight_kg: 74.5, fitness_level: 'advanced' });
  });

  it('explicit nulls on optional fields mean "not sent"', async () => {
    const res = await send(settings, 'PUT', { height_cm: 178, weight_kg: null, date_of_birth: null, timezone: null });
    expect(res.status).toBe(200);
    expect(Object.keys(state.settingsWrites[0]).sort()).toEqual(['height_cm', 'updated_at']);
  });

  it('validation error: envelope kept, message says what is wrong', async () => {
    const res = await send(settings, 'PUT', { height_cm: 10 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toMatch(/^height_cm: /);
  });
});

describe('POST /api/mobile/onboarding/assessment', () => {
  const valid = {
    exercise_frequency: '3-4x_week',
    primary_goal: 'lose_weight',
    preferred_workouts: ['cardio', 'yoga'],
    daily_time: '30min',
    fitness_self_assessment: 'some_experience',
  };

  it('old request shape works', async () => {
    const res = await send(assessment, 'POST', valid);
    expect(res.status).toBe(200);
    expect(state.assessments).toEqual([valid]);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['fitnessLevel', 'preferredWorkoutTypes', 'timeCommitment']);
  });

  it('validation error: envelope and details map kept, message says what is wrong', async () => {
    const res = await send(assessment, 'POST', { ...valid, daily_time: '2h' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.details.daily_time).toBe('string');
    expect(body.error.message).toMatch(/^daily_time: /);
    expect(state.assessments).toHaveLength(0);
  });
});

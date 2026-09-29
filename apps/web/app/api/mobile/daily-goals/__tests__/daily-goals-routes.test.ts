import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase } from '@/lib/services/__tests__/helpers/fake-supabase';

const requireMobileAuth = vi.fn();
let fake = createFakeSupabase();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_req: unknown, res: unknown) => res,
}));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => {
      const builder = fake.client.from(table);
      // The create route filters with `.or(...)`, which the fake does not model.
      builder.or = () => builder;
      return builder;
    },
  }),
}));
vi.mock('@/lib/services/daily-goals', () => ({ DailyGoalService: {} }));

import { PATCH } from '../[id]/route';
import { POST } from '../route';

const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const json = (url: string, body: unknown, method: string) =>
  new Request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const create = (body: unknown) => POST(json('http://localhost/api/mobile/daily-goals', body, 'POST'));
const update = (body: unknown) =>
  PATCH(json(`http://localhost/api/mobile/daily-goals/${GOAL_ID}`, body, 'PATCH'), {
    params: Promise.resolve({ id: GOAL_ID }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createFakeSupabase({
    daily_goals: [{ id: GOAL_ID, user_id: 'user-1', goal_type: 'workout', target_value: 1, is_active: false }],
  });
  requireMobileAuth.mockResolvedValue({ id: 'user-1' });
});

const created = () => fake.rows('daily_goals').find((g) => g.id !== GOAL_ID)!;

describe('POST /api/mobile/daily-goals', () => {
  it('iOS shape: snake_case keys, ISO timestamps, unknown custom_schedule', async () => {
    const res = await create({
      goal_type: 'steps',
      target_value: 10000,
      unit: 'steps',
      start_date: '2026-09-28T07:00:00Z',
      frequency: 'daily',
      is_primary: true,
      auto_adjust_enabled: false,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ goal_type: 'steps', target_value: 10000, is_primary: true });
    expect(created()).toMatchObject({ start_date: '2026-09-28', end_date: null, user_id: 'user-1' });
  });

  it('current Android shape: snake_case with a plain date', async () => {
    const res = await create({
      goal_type: 'steps',
      target_value: 8000,
      unit: 'steps',
      start_date: '2026-09-28',
      frequency: 'daily',
      is_primary: false,
      auto_adjust_enabled: false,
    });
    expect(res.status).toBe(200);
    expect(created()).toMatchObject({ goal_type: 'steps', target_value: 8000, start_date: '2026-09-28' });
  });

  it('older Android shape: camelCase keys with explicit nulls', async () => {
    const res = await create({
      challengeId: null,
      goalType: 'steps',
      targetValue: 7500,
      unit: 'steps',
      startDate: '2026-09-28',
      endDate: null,
      frequency: 'daily',
      isPrimary: true,
      autoAdjustEnabled: true,
    });
    expect(res.status).toBe(200);
    expect(created()).toMatchObject({
      goal_type: 'steps',
      target_value: 7500,
      start_date: '2026-09-28',
      end_date: null,
      is_primary: true,
      auto_adjust_enabled: true,
      challenge_id: null,
    });
  });

  it('explicit nulls on optional snake_case fields are tolerated', async () => {
    const res = await create({ goal_type: 'weight_log', target_value: null, unit: null, frequency: null, is_primary: null });
    expect(res.status).toBe(200);
    expect(created()).toMatchObject({ goal_type: 'weight_log', frequency: 'daily', is_primary: false });
  });

  it('a missing goal type is still a 400; the error keeps its keys and gets a specific message', async () => {
    const res = await create({ target_value: 10000 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toContain('goal_type');
    expect(body.error.timestamp).toBeDefined();
  });
});

describe('PATCH /api/mobile/daily-goals/[id]', () => {
  it('iOS / Android shape: snake_case target update (unknown auto_adjust_enabled is ignored as before)', async () => {
    const res = await update({ target_value: 12000, is_primary: true, auto_adjust_enabled: true });
    expect(res.status).toBe(200);
    const goal = fake.rows('daily_goals')[0];
    expect(goal).toMatchObject({ target_value: 12000, is_primary: true });
    expect(goal).not.toHaveProperty('auto_adjust_enabled');
  });

  it('camelCase keys are accepted', async () => {
    const res = await update({ targetValue: 9000, isActive: true });
    expect(res.status).toBe(200);
    expect(fake.rows('daily_goals')[0]).toMatchObject({ target_value: 9000, is_active: true });
  });

  it('a null on an optional field is ignored; null end_date still clears it', async () => {
    fake.rows('daily_goals')[0].end_date = '2026-12-31';
    const res = await update({ target_value: null, is_primary: null, end_date: null });
    expect(res.status).toBe(200);
    expect(fake.rows('daily_goals')[0]).toMatchObject({ target_value: 1, end_date: null });
  });

  it('validation errors carry a specific message', async () => {
    const res = await update({ target_value: -5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain('target_value');
  });
});

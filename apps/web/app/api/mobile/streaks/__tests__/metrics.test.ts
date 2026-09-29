/**
 * GET /api/mobile/streaks/metrics: keyed object (Android) plus the additional
 * total_logs_count and trend. Real handler and service, in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET as getMetrics } from '../metrics/route';

vi.mock('@/lib/supabase-admin');

const USER = 'user-1';
const NOW = new Date('2026-09-28T12:00:00Z');

let authedUser: { id: string } | null = { id: USER };
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));

let db: FakeSupabase;

function seedStreak(metric: string, current: number, longest: number, lastLog: string | null) {
  db.seed('metric_streaks', [
    {
      id: `ms-${metric}`,
      user_id: USER,
      metric_type: metric,
      current_streak: current,
      longest_streak: longest,
      last_log_date: lastLog,
      grace_days_available: 1,
    },
  ]);
}

function seedDay(date: string, values: { weight_kg?: number | null; steps?: number | null; mood_score?: number | null }) {
  db.seed('daily_tracking', [
    {
      user_id: USER,
      tracking_date: date,
      weight_kg: values.weight_kg ?? null,
      steps: values.steps ?? null,
      mood_score: values.mood_score ?? null,
    },
  ]);
}

const get = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/mobile/streaks/metrics', { headers });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  authedUser = { id: USER };
  db = new FakeSupabase({
    metric_streaks: { uniqueKey: ['user_id', 'metric_type'] },
    daily_tracking: { uniqueKey: ['user_id', 'tracking_date'] },
  });
  (createAdminSupabase as any).mockReturnValue(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/mobile/streaks/metrics', () => {
  it('stays an object keyed by metric, null for a metric without a streak', async () => {
    seedStreak('weight', 3, 8, '2026-09-28');

    const body = await (await getMetrics(get())).json();

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(false);
    expect(Object.keys(body.data)).toEqual(['weight', 'steps', 'mood', 'measurements', 'photos']);
    expect(body.data.steps).toBeNull();
    expect(body.data.mood).toBeNull();
    expect(body.data.measurements).toBeNull();
    expect(body.data.photos).toBeNull();
  });

  it('keeps the existing fields of a streak', async () => {
    seedStreak('steps', 4, 11, '2026-09-27');

    const { data } = await (await getMetrics(get())).json();

    expect(data.steps).toMatchObject({
      metric_type: 'steps',
      current_streak: 4,
      longest_streak: 11,
      last_log_date: '2026-09-27',
      grace_days_available: 1,
      grace_days_used: 0,
    });
  });

  it('adds total_logs_count per metric, counting only days with a value', async () => {
    seedStreak('weight', 1, 1, '2026-09-28');
    seedStreak('steps', 1, 1, '2026-09-28');
    seedStreak('mood', 0, 0, null);
    seedDay('2026-05-01', { weight_kg: 81.2 }); // older than the trend, still counted
    seedDay('2026-09-26', { weight_kg: 80.4, steps: 6000 });
    seedDay('2026-09-27', { steps: 0 }); // a logged zero is a log, as in the streak calculation
    seedDay('2026-09-28', { weight_kg: 80.1, steps: 9000 });

    const { data } = await (await getMetrics(get())).json();

    expect(data.weight.total_logs_count).toBe(3);
    expect(data.steps.total_logs_count).toBe(3);
    expect(data.mood.total_logs_count).toBe(0);
  });

  it('adds a 30-day trend, oldest first, ending today', async () => {
    seedStreak('weight', 2, 2, '2026-09-28');
    seedStreak('mood', 1, 1, '2026-09-28');
    seedDay('2026-08-01', { weight_kg: 83 }); // outside the 30 days
    seedDay('2026-08-30', { weight_kg: 82.5 }); // first day of the window
    seedDay('2026-09-27', { weight_kg: 80.4 });
    seedDay('2026-09-28', { weight_kg: 80.1, mood_score: 4 });

    const { data } = await (await getMetrics(get())).json();

    expect(data.weight.trend).toHaveLength(30);
    expect(data.weight.trend[0]).toEqual({ date: '2026-08-30', logged: true, value: 82.5 });
    expect(data.weight.trend[1]).toEqual({ date: '2026-08-31', logged: false, value: null });
    expect(data.weight.trend[28]).toEqual({ date: '2026-09-27', logged: true, value: 80.4 });
    expect(data.weight.trend[29]).toEqual({ date: '2026-09-28', logged: true, value: 80.1 });
    expect(data.weight.trend.filter((p: any) => p.logged)).toHaveLength(3);

    expect(data.mood.trend[29]).toEqual({ date: '2026-09-28', logged: true, value: 4 });
    expect(data.mood.trend.filter((p: any) => p.logged)).toHaveLength(1);
  });

  it("ends the trend on the user's today", async () => {
    // 28 September 23:30 in Los Angeles is 29 September in UTC.
    vi.setSystemTime(new Date('2026-09-29T06:30:00Z'));
    seedStreak('steps', 1, 1, '2026-09-28');
    seedDay('2026-09-28', { steps: 7000 });

    const { data } = await (
      await getMetrics(get({ 'x-client-timezone': 'America/Los_Angeles' }))
    ).json();

    expect(data.steps.trend[29]).toEqual({ date: '2026-09-28', logged: true, value: 7000 });
  });

  it('reports zero logs for measurements and photos, which have no log table yet', async () => {
    seedStreak('measurements', 0, 0, null);
    seedStreak('photos', 0, 0, null);

    const { data } = await (await getMetrics(get())).json();

    expect(data.measurements.total_logs_count).toBe(0);
    expect(data.measurements.trend).toHaveLength(30);
    expect(data.measurements.trend.every((p: any) => p.logged === false && p.value === null)).toBe(true);
    expect(data.photos.total_logs_count).toBe(0);
  });

  it('still returns the streaks when the history cannot be read', async () => {
    seedStreak('weight', 3, 8, '2026-09-28');
    const failing = {
      from: (table: string) => {
        if (table === 'daily_tracking') throw new Error('boom');
        return db.from(table);
      },
    };
    (createAdminSupabase as any).mockReturnValue(failing);

    const res = await getMetrics(get());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.weight).toMatchObject({ metric_type: 'weight', current_streak: 3 });
    expect(body.data.weight).not.toHaveProperty('trend');
  });
});

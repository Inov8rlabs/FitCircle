/**
 * POST /api/mobile/tracking/daily — the `date` alias for `trackingDate`.
 *
 * Every shipped iOS build since Jan 2026 encodes DailyTrackingCreate's day under the
 * JSON key "date" (FitCircle-iOS DailyTracking.swift, `case trackingDate = "date"`).
 * The route only read `trackingDate`, zod stripped `date`, and every past-day iOS entry
 * (manual backfill, HealthKit weight sync) was saved to TODAY.
 *
 * These tests run the REAL route, the REAL MobileAPIService.upsertDailyTracking and the
 * REAL timezone utilities against an in-memory Supabase; only the streak / goal services
 * (whose arguments are asserted) and auth are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase } from '@/lib/services/__tests__/helpers/fake-supabase';

const requireMobileAuth = vi.fn();
const recordActivity = vi.fn();
const updateMetricStreak = vi.fn();
const claimStreak = vi.fn();
const updateGoalCompletion = vi.fn();

let fake = createFakeSupabase();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => fake.client }));
vi.mock('@/lib/services/engagement-streak-service', () => ({
  EngagementStreakService: { recordActivity: (...a: unknown[]) => recordActivity(...a) },
}));
vi.mock('@/lib/services/metric-streak-service', () => ({
  MetricStreakService: { updateMetricStreak: (...a: unknown[]) => updateMetricStreak(...a) },
}));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: { claimStreak: (...a: unknown[]) => claimStreak(...a) },
}));
vi.mock('@/lib/services/daily-goals', () => ({
  DailyGoalService: { updateGoalCompletion: (...a: unknown[]) => updateGoalCompletion(...a) },
}));
vi.mock('@/lib/services/challenge-steps-sync-service', () => ({
  ChallengeStepsSyncService: { syncUser: vi.fn() },
}));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: vi.fn() }));

import { MobileAPIService } from '@/lib/services/mobile-api-service';

import { POST } from '../daily/route';

const USER = 'user-1';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/mobile/tracking/daily', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as any
  );

/** Freeze the clock and give the member a profile timezone. */
function setup(nowIso: string, timezone: string, dailyTracking: Record<string, any>[] = []) {
  vi.setSystemTime(new Date(nowIso));
  fake = createFakeSupabase({
    profiles: [{ id: USER, timezone }],
    daily_tracking: dailyTracking,
  });
}

const rows = () => fake.rows('daily_tracking');
const rowFor = (date: string) => rows().find((r) => r.tracking_date === date);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  requireMobileAuth.mockResolvedValue({ id: USER });
  vi.spyOn(MobileAPIService, 'getDailyTrackingWithStats').mockResolvedValue({ data: [], stats: {} } as any);
  updateGoalCompletion.mockResolvedValue({ success: true, completions: [], error: null });
  claimStreak.mockResolvedValue({ streakCount: 4 });
  // Toronto, Thu 2026-11-05 12:00 local.
  setup('2026-11-05T17:00:00Z', 'America/Toronto');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('date key resolution', () => {
  it('alias only: `date` is honoured (was: saved to today)', async () => {
    const res = await post({ date: '2026-11-02', weightKg: 80.4 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toMatchObject({ tracking_date: '2026-11-02', is_backfill: true });
    expect(rowFor('2026-11-02')?.weight_kg).toBe(80.4);
    expect(rowFor('2026-11-05')).toBeUndefined();
  });

  it('trackingDate only: unchanged', async () => {
    const res = await post({ trackingDate: '2026-11-03', weightKg: 81 });
    expect(res.status).toBe(200);
    expect((await res.json()).meta.tracking_date).toBe('2026-11-03');
    expect(rowFor('2026-11-03')?.weight_kg).toBe(81);
  });

  it('both present: trackingDate wins', async () => {
    const res = await post({ trackingDate: '2026-11-03', date: '2026-11-01', weightKg: 81 });
    expect(res.status).toBe(200);
    expect((await res.json()).meta.tracking_date).toBe('2026-11-03');
    expect(rows().map((r) => r.tracking_date)).toEqual(['2026-11-03']);
  });

  it('both present: a malformed alias is ignored when trackingDate is valid', async () => {
    const res = await post({ trackingDate: '2026-11-03', date: 'yesterday', weightKg: 81 });
    expect(res.status).toBe(200);
    expect((await res.json()).meta.tracking_date).toBe('2026-11-03');
  });

  it('`date: null` (what iOS sends with no date) means today', async () => {
    const res = await post({ date: null, weightKg: 82 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toMatchObject({ tracking_date: '2026-11-05', is_backfill: false });
    expect(rowFor('2026-11-05')?.weight_kg).toBe(82);
  });

  it('no date key at all means today', async () => {
    const res = await post({ weightKg: 82 });
    expect((await res.json()).meta.tracking_date).toBe('2026-11-05');
  });

  it('a malformed alias is a 400 VALIDATION_ERROR (not a silent "today")', async () => {
    const res = await post({ date: '2026-11-02T10:00:00Z', weightKg: 80 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('date');
    expect(rows()).toHaveLength(0);
  });
});

describe('7-day window applies to the alias', () => {
  it('exactly 7 days back is accepted', async () => {
    const res = await post({ date: '2026-10-29', weightKg: 80 });
    expect(res.status).toBe(200);
    expect(rowFor('2026-10-29')).toBeDefined();
  });

  it('8+ days back is a 400 INVALID_DATE with the user-facing message, and writes nothing', async () => {
    const res = await post({ date: '2026-10-20', weightKg: 80, notes: 'old' });
    expect(res.status).toBe(400);
    const body = await res.json();
    // APIErrorBody on iOS turns a 4xx with this shape into APIError(message) — the
    // past-date sheet and Historical Data screen show exactly this text.
    expect(body).toMatchObject({
      success: false,
      error: { code: 'INVALID_DATE', message: 'Can only log data for the last 7 days' },
    });
    expect(rows()).toHaveLength(0);
    expect(updateGoalCompletion).not.toHaveBeenCalled();
  });

  it('2+ days in the future is a 400', async () => {
    const res = await post({ date: '2026-11-07', weightKg: 80 });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_DATE');
  });
});

describe('timezone edges', () => {
  it('late evening in America/Toronto: the local day is used, not the UTC day', async () => {
    // Wed 2026-11-04 22:30 in Toronto = Thu 03:30 UTC.
    setup('2026-11-05T03:30:00Z', 'America/Toronto');
    const res = await post({ date: '2026-11-04', weightKg: 80 });
    expect((await res.json()).meta).toMatchObject({ tracking_date: '2026-11-04', is_backfill: false });

    const res2 = await post({ date: '2026-11-03', weightKg: 79 });
    expect((await res2.json()).meta).toMatchObject({ tracking_date: '2026-11-03', is_backfill: true });
  });

  it('Toronto member whose profile timezone is still UTC: the device day is stored', async () => {
    // Device: Wed 22:30 local. Server (UTC profile): already Thu.
    setup('2026-11-05T03:30:00Z', 'UTC');
    const res = await post({ date: '2026-11-04', weightKg: 80 });
    expect((await res.json()).meta.tracking_date).toBe('2026-11-04');
    expect(rowFor('2026-11-05')).toBeUndefined();
  });

  it('member ahead of a stale profile timezone: alias "tomorrow" is saved to today, as before', async () => {
    // Profile UTC: Wed 23:30. Device in Singapore: already Thu 07:30.
    setup('2026-11-04T23:30:00Z', 'UTC');
    const res = await post({ date: '2026-11-05', weightKg: 80 });
    expect(res.status).toBe(200);
    expect((await res.json()).meta).toMatchObject({ tracking_date: '2026-11-04', is_backfill: false });
  });

  it('trackingDate "tomorrow" keeps its existing 400 (behaviour unchanged)', async () => {
    setup('2026-11-04T23:30:00Z', 'UTC');
    const res = await post({ trackingDate: '2026-11-05', weightKg: 80 });
    expect(res.status).toBe(400);
  });
});

describe('streaks and goals follow the corrected date', () => {
  it('manual past-day weight: activity, metric streak, streak claim and goals all on that day', async () => {
    const res = await post({ date: '2026-11-03', weightKg: 80, isOverride: false });
    expect(res.status).toBe(200);
    const id = rowFor('2026-11-03')!.id;
    expect(recordActivity).toHaveBeenCalledWith(USER, 'weight_log', id, '2026-11-03');
    expect(updateMetricStreak).toHaveBeenCalledWith(USER, 'weight', '2026-11-03');
    expect(claimStreak).toHaveBeenCalledWith(USER, '2026-11-03', expect.any(String), 'manual_entry');
    expect(updateGoalCompletion).toHaveBeenCalledWith(USER, '2026-11-03', expect.objectContaining({ weight_kg: 80 }));
    // Nothing recorded against today.
    for (const mock of [recordActivity, updateMetricStreak, claimStreak, updateGoalCompletion]) {
      expect(JSON.stringify(mock.mock.calls)).not.toContain('2026-11-05');
    }
  });

  it('HealthKit weight sync (autoClaimStreak false): past day updated, no streak, today untouched', async () => {
    setup('2026-11-05T17:00:00Z', 'America/Toronto', [
      { id: 'today', user_id: USER, tracking_date: '2026-11-05', weight_kg: 79.1, steps: 4000, steps_source: 'healthkit' },
    ]);
    const res = await post({ date: '2026-11-01', weightKg: 80.6, isOverride: false, autoClaimStreak: false });
    expect(res.status).toBe(200);
    expect(rowFor('2026-11-01')?.weight_kg).toBe(80.6);
    expect(rowFor('2026-11-05')?.weight_kg).toBe(79.1);
    expect(recordActivity).not.toHaveBeenCalled();
    expect(claimStreak).not.toHaveBeenCalled();
    expect(updateGoalCompletion).toHaveBeenCalledWith(USER, '2026-11-01', expect.objectContaining({ weight_kg: 80.6 }));
  });
});

describe('shipped-client compatibility: exact iOS 1.1.1 bodies', () => {
  // Byte-for-byte what DailyTrackingCreate.encode(to:) produces in 1.1.1 (05c247d):
  // "date" first (encodeNil when absent), then encodeIfPresent fields in CodingKeys order.
  const IOS_111_PAST_DATE_SHEET =
    '{"date":"2026-11-03","weightKg":80.2,"steps":6400,"notes":"felt good","stepsSource":"manual","isOverride":true}';
  const IOS_111_HEALTHKIT_WEIGHT =
    '{"date":"2026-11-02","weightKg":80.85,"isOverride":false,"autoClaimStreak":false}';
  const IOS_111_LOG_TODAY = '{"date":"2026-11-05","weightKg":81,"isOverride":false}';
  const IOS_111_NO_DATE = '{"date":null,"weightKg":81,"notes":"Initial check-in from onboarding","isOverride":false}';

  const raw = (text: string) =>
    POST(
      new Request('http://localhost/api/mobile/tracking/daily', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: text,
      }) as any
    );

  it('past-date sheet (manual weight + steps) lands on the chosen day', async () => {
    const res = await raw(IOS_111_PAST_DATE_SHEET);
    expect(res.status).toBe(200);
    expect(rowFor('2026-11-03')).toMatchObject({
      weight_kg: 80.2,
      steps: 6400,
      steps_source: 'manual',
      is_override: true,
      notes: 'felt good',
    });
    expect(rowFor('2026-11-05')).toBeUndefined();
  });

  it('HealthKit weight sync lands on the sample day and skips the streak', async () => {
    const res = await raw(IOS_111_HEALTHKIT_WEIGHT);
    expect(res.status).toBe(200);
    expect(rowFor('2026-11-02')?.weight_kg).toBe(80.85);
    expect(claimStreak).not.toHaveBeenCalled();
  });

  it('the whole 7-day HealthKit burst writes one row per day instead of racing on today', async () => {
    const days = ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
    // iOS fires these from a task group; order does not matter once each carries its own day.
    for (const [i, d] of [...days.entries()].reverse()) {
      await raw(`{"date":"${d}","weightKg":${80 + i / 10},"isOverride":false,"autoClaimStreak":false}`);
    }
    expect(rows().map((r) => r.tracking_date).sort()).toEqual(days);
    days.forEach((d, i) => expect(rowFor(d)?.weight_kg).toBe(80 + i / 10));
  });

  it('log-today and no-date bodies still save to today', async () => {
    expect((await (await raw(IOS_111_LOG_TODAY)).json()).meta.tracking_date).toBe('2026-11-05');
    expect((await (await raw(IOS_111_NO_DATE)).json()).meta.tracking_date).toBe('2026-11-05');
    expect(rows()).toHaveLength(1);
  });
});

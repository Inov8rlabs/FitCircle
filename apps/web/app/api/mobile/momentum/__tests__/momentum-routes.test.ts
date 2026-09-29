/**
 * Momentum routes: the original keys (Android, web) and the keys the iOS model
 * reads must both be present. Real handlers and service, in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as checkIn } from '../check-in/route';
import { GET as getMilestones } from '../milestones/route';
import { GET as getStatus } from '../status/route';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/chat-activity-hooks', () => ({
  ChatActivityHooks: { onStreakMilestone: vi.fn().mockResolvedValue(undefined) },
}));

const USER = 'user-1';
const NOW = new Date('2026-09-28T12:00:00Z');
const TODAY = '2026-09-28';

let authedUser: { id: string } | null = { id: USER };
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));

let db: FakeSupabase;

function seedMomentum(opts: {
  current: number;
  best: number;
  lastEngagement?: string | null;
  graceUsed?: boolean | null;
  claims?: number;
}) {
  db.seed('engagement_streaks', [
    {
      user_id: USER,
      current_streak: opts.current,
      longest_streak: opts.best,
      best_momentum: opts.best,
      momentum_flame_level: 1,
      last_engagement_date: opts.lastEngagement ?? null,
      grace_day_used_this_week: opts.graceUsed === undefined ? false : opts.graceUsed,
      grace_day_week_start: '2026-09-28', // Monday of the test week
      paused: false,
    },
  ]);
  const claims = opts.claims ?? 0;
  for (let n = claims; n >= 1; n--) {
    const day = new Date(NOW);
    day.setUTCDate(day.getUTCDate() - n);
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day.toISOString().slice(0, 10), claim_method: 'explicit' },
    ]);
  }
}

const get = (path: string) => new NextRequest(`http://localhost${path}`);
const post = (path: string) => new NextRequest(`http://localhost${path}`, { method: 'POST' });

/**
 * The decode the submitted iOS build performs on `data`
 * (FitCircle/Core/Models/Momentum.swift, MomentumStatus): every non-optional
 * Swift property must be present with the right JSON type.
 */
function expectDecodableAsSwiftMomentumStatus(data: any) {
  expect(Number.isInteger(data.current_momentum)).toBe(true);
  expect(Number.isInteger(data.best_momentum)).toBe(true);
  expect(Number.isInteger(data.flame_level)).toBe(true);
  expect(typeof data.grace_day_available).toBe('boolean');
  expect(typeof data.grace_day_used_this_week).toBe('boolean');

  // next_milestone: NextMilestone? — absent/null is fine, otherwise all four keys.
  if (data.next_milestone !== null && data.next_milestone !== undefined) {
    expect(typeof data.next_milestone.name).toBe('string');
    expect(Number.isInteger(data.next_milestone.days_away)).toBe(true);
    expect(Number.isInteger(data.next_milestone.day_threshold)).toBe(true);
    expect(typeof data.next_milestone.badge_emoji).toBe('string');
  }

  // decay_info: DecayInfo? — optional; when present both keys are required.
  if (data.decay_info !== null && data.decay_info !== undefined) {
    expect(Number.isInteger(data.decay_info.days_until_decay)).toBe(true);
    expect(Number.isInteger(data.decay_info.decay_amount)).toBe(true);
  }

  // recent_milestones: [MomentumMilestone] — REQUIRED array.
  expect(Array.isArray(data.recent_milestones)).toBe(true);
  for (const milestone of data.recent_milestones) {
    expect(typeof milestone.name).toBe('string');
    expect(Number.isInteger(milestone.day_threshold)).toBe(true);
    expect(typeof milestone.badge_emoji).toBe('string');
    // unlocked_at: Date? — a date-only or ISO-8601 string when present.
    if (milestone.unlocked_at !== null && milestone.unlocked_at !== undefined) {
      expect(milestone.unlocked_at).toMatch(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/);
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  authedUser = { id: USER };
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/mobile/momentum/status', () => {
  it('keeps every existing key with its value', async () => {
    seedMomentum({ current: 9, best: 15, lastEngagement: TODAY, claims: 15 });

    const body = await (await getStatus(get('/api/mobile/momentum/status'))).json();

    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      current_momentum: 9,
      best_momentum: 15,
      flame_level: 2,
      flame_label: 'Flame',
      grace_day_available: true,
      grace_day_used_this_week: false,
      days_to_next_milestone: 5,
      last_check_in_date: TODAY,
      checked_in_today: true,
    });
    expect(body.data.next_milestone).toMatchObject({
      days: 14,
      name: '2-Week Blaze',
      description: 'Two weeks strong!',
      badge: '🏆',
      unlocked: false,
    });
  });

  it('adds the keys the iOS model reads, with the same values', async () => {
    seedMomentum({ current: 9, best: 15, lastEngagement: TODAY, claims: 15 });

    const { data } = await (await getStatus(get('/api/mobile/momentum/status'))).json();

    expect(data.next_milestone.day_threshold).toBe(data.next_milestone.days);
    expect(data.next_milestone.badge_emoji).toBe(data.next_milestone.badge);
    expect(data.next_milestone.days_away).toBe(data.days_to_next_milestone);

    expect(data.recent_milestones.map((m: any) => m.days)).toEqual([3, 7, 14]);
    for (const milestone of data.recent_milestones) {
      expect(milestone.day_threshold).toBe(milestone.days);
      expect(milestone.badge_emoji).toBe(milestone.badge);
      expect(milestone.unlocked).toBe(true);
    }
    expectDecodableAsSwiftMomentumStatus(data);
  });

  it('is decodable for a brand-new user and at the last milestone', async () => {
    seedMomentum({ current: 0, best: 0 });
    const fresh = await (await getStatus(get('/api/mobile/momentum/status'))).json();
    expect(fresh.data.recent_milestones).toEqual([]);
    expect(fresh.data.next_milestone.days).toBe(3);
    expectDecodableAsSwiftMomentumStatus(fresh.data);

    db = makeStreakDb();
    (createAdminSupabase as any).mockReturnValue(db);
    seedMomentum({ current: 400, best: 400, claims: 3 });
    const veteran = await (await getStatus(get('/api/mobile/momentum/status'))).json();
    expect(veteran.data.next_milestone).toBeNull();
    expect(veteran.data.days_to_next_milestone).toBeNull();
    expect(veteran.data.recent_milestones).toHaveLength(7);
    // Fewer claims than days: the unlock date is unknown and is left out.
    expect(veteran.data.recent_milestones[6].unlocked_at).toBeUndefined();
    expectDecodableAsSwiftMomentumStatus(veteran.data);
  });

  it('sends a boolean even when the grace column is null', async () => {
    seedMomentum({ current: 2, best: 2, graceUsed: null });
    const { data } = await (await getStatus(get('/api/mobile/momentum/status'))).json();
    expect(data.grace_day_used_this_week).toBe(false);
    expect(data.grace_day_available).toBe(true);
    expectDecodableAsSwiftMomentumStatus(data);
  });

  it('does not send decay_info or a per-day history it cannot compute', async () => {
    seedMomentum({ current: 9, best: 15 });
    const { data } = await (await getStatus(get('/api/mobile/momentum/status'))).json();
    expect(data).not.toHaveProperty('decay_info');
    expect(data).not.toHaveProperty('history');
  });
});

describe('POST /api/mobile/momentum/check-in', () => {
  it('keeps the check-in result and adds the status fields', async () => {
    seedMomentum({ current: 6, best: 6, lastEngagement: '2026-09-27', claims: 6 });

    const body = await (await checkIn(post('/api/mobile/momentum/check-in'))).json();

    expect(body.success).toBe(true);
    // Existing keys (Android MomentumCheckInResult).
    expect(body.data).toMatchObject({
      new_momentum: 7,
      best_momentum: 7,
      flame_level: 2,
      flame_label: 'Flame',
      is_first_check_in_today: true,
      grace_day_available: true,
    });
    expect(body.data.milestone_achieved).toMatchObject({
      days: 7,
      name: '1-Week Flame',
      badge: '💪',
      unlocked: true,
      day_threshold: 7,
      badge_emoji: '💪',
    });
    // Additional keys: the status, which is what iOS decodes from this response.
    expect(body.data.current_momentum).toBe(7);
    expect(body.data.checked_in_today).toBe(true);
    expectDecodableAsSwiftMomentumStatus(body.data);
  });

  it('is idempotent on the same day', async () => {
    seedMomentum({ current: 7, best: 7, lastEngagement: TODAY, claims: 7 });

    const body = await (await checkIn(post('/api/mobile/momentum/check-in'))).json();

    expect(body.data.new_momentum).toBe(7);
    expect(body.data.is_first_check_in_today).toBe(false);
    expect(body.data.milestone_achieved).toBeNull();
    expect(db.getRows('engagement_streaks')[0].current_streak).toBe(7);
  });
});

describe('GET /api/mobile/momentum/milestones', () => {
  it('keeps the { milestones: [...] } object and adds the alias keys', async () => {
    seedMomentum({ current: 8, best: 8, claims: 8 });

    const body = await (await getMilestones(get('/api/mobile/momentum/milestones'))).json();

    expect(Array.isArray(body.data)).toBe(false);
    expect(body.data.milestones).toHaveLength(2);
    expect(body.data.milestones[0]).toEqual({
      days: 3,
      name: '3-Day Spark',
      description: 'Your momentum is building!',
      badge: '🔥',
      unlocked: true,
      unlocked_at: '2026-09-22',
      day_threshold: 3,
      badge_emoji: '🔥',
    });
  });
});

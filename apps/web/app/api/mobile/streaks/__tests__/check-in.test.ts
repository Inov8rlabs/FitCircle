/**
 * POST /api/mobile/streaks/check-in: what each shipped client sends must be
 * accepted. Real handler and service, in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as checkIn } from '../check-in/route';
import { GET as getStatus } from '../status/route';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: vi.fn(async (_request: unknown, response: unknown) => response),
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

function seedUser(claims: string[] = []) {
  db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: 1 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0, metadata: {} },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [
    {
      user_id: USER,
      current_streak: claims.length,
      longest_streak: claims.length,
      streak_freezes_available: 1,
      paused: false,
      total_points: 0,
      last_engagement_date: claims[claims.length - 1] ?? null,
    },
  ]);
  for (const day of claims) {
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day, claim_method: 'explicit', timezone: 'UTC', metadata: {} },
    ]);
  }
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/mobile/streaks/check-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const tracking = () => db.getRows('daily_tracking')[0];

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

describe('POST /api/mobile/streaks/check-in', () => {
  it('stores the sentiment iOS sends as previous_day_sentiment', async () => {
    seedUser();

    // Exactly what StreakCheckInRequest encodes: nil date/weight/notes are omitted.
    const res = await checkIn(
      post({
        previous_day_sentiment: 'could_be_better',
        mood: 4,
        energy: 2,
        timezone: 'America/Los_Angeles',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.newStreak).toBe(1);
    expect(tracking()).toMatchObject({
      previous_day_sentiment: 'could_be_better',
      mood_score: 4,
      energy_level: 2,
    });
  });

  it('still stores the sentiment Android sends as previousDaySentiment', async () => {
    seedUser();

    const res = await checkIn(
      post({ date: TODAY, previousDaySentiment: 'great', mood: 5, energy: 5, timezone: 'UTC' })
    );

    expect(res.status).toBe(200);
    expect(tracking().previous_day_sentiment).toBe('great');
  });

  it('prefers the camelCase key when both are present', async () => {
    seedUser();

    await checkIn(
      post({ previousDaySentiment: 'ok', previous_day_sentiment: 'great', mood: 3, energy: 3 })
    );

    expect(tracking().previous_day_sentiment).toBe('ok');
  });

  it('ignores a snake_case sentiment outside the enum instead of rejecting the check-in', async () => {
    seedUser();

    for (const value of ['', 'meh', 7, null, { nested: true }]) {
      const res = await checkIn(post({ previous_day_sentiment: value, mood: 3, energy: 3 }));
      expect(res.status).toBe(200);
    }
    expect(tracking().previous_day_sentiment).toBeUndefined();
  });

  it('accepts the whole 1 to 5 range both clients can send for mood and energy', async () => {
    seedUser();

    for (const value of [1, 2, 3, 4, 5]) {
      const res = await checkIn(post({ mood: value, energy: value }));
      expect(res.status).toBe(200);
    }
    expect(tracking()).toMatchObject({ mood_score: 5, energy_level: 5 });
  });

  it('accepts explicit nulls for every optional field', async () => {
    seedUser();

    const res = await checkIn(
      post({
        date: null,
        timezone: null,
        previousDaySentiment: null,
        previous_day_sentiment: null,
        weight: null,
        notes: null,
        mood: 3,
        energy: 3,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.isFirstCheckInToday).toBe(true);
    expect(tracking().tracking_date).toBe(TODAY);
    expect(tracking().weight_kg).toBeUndefined();
  });

  it('keeps rejecting what was rejected, now with a readable message', async () => {
    seedUser();

    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ mood: 0, energy: 3 }, /^mood: /],
      [{ mood: 3, energy: 6 }, /^energy: /],
      [{ energy: 3 }, /^mood: /],
      [{ mood: null, energy: 3 }, /^mood: /],
      [{ mood: 3, energy: 3, previousDaySentiment: 'meh' }, /^previousDaySentiment: /],
      [{ mood: 3, energy: 3, date: '28/09/2026' }, /^date: /],
      [{ mood: 3, energy: 3, weight: -2 }, /^weight: /],
    ];

    for (const [payload, message] of cases) {
      const res = await checkIn(post(payload));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(message);
      expect(Array.isArray(body.error.details)).toBe(true);
      expect(body.error.timestamp).toEqual(expect.any(String));
    }
    expect(db.getRows('daily_tracking')).toHaveLength(0);
  });

  it('sends the milestone under the keys both clients decode', async () => {
    seedUser(['2026-09-26', '2026-09-27']);

    const body = await (await checkIn(post({ mood: 4, energy: 4 }))).json();

    expect(body.data.newStreak).toBe(3);
    expect(body.data.milestoneAchieved).toEqual({
      // Android CheckinMilestone
      days: 3,
      name: '3-Day Spark',
      description: 'Habit ignited — three days in a row!',
      badge: '✨',
      // iOS StreakMilestone additionally requires these
      id: 1,
      title: '3-Day Spark',
      is_achieved: true,
    });
  });
});

describe('GET /api/mobile/streaks/status', () => {
  const get = () => new NextRequest('http://localhost/api/mobile/streaks/status');

  it('keeps the existing fields and leaves totalPoints as the XP earned', async () => {
    seedUser(['2026-09-27']);
    db.getRows('engagement_streaks')[0].total_points = 140;

    const body = await (await getStatus(get())).json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      currentStreak: 1,
      longestStreak: 1,
      lastCheckInDate: '2026-09-27',
      hasCheckedInToday: false,
      freezesAvailable: 1,
      shieldsUnlimited: false,
      nextMilestone: 3,
      daysUntilNextMilestone: 2,
      canCheckInAgain: true,
      streakColor: 'gray',
      totalPoints: 140,
    });
    // Without the spent ledger (migration 095) the balance is not reported.
    expect(body.data).not.toHaveProperty('pointsBalance');
    expect(body.data).not.toHaveProperty('pointsSpent');
  });

  it('adds the spendable balance once the spent ledger exists', async () => {
    seedUser(['2026-09-27']);
    Object.assign(db.getRows('engagement_streaks')[0], { total_points: 140, points_spent: 100 });

    const body = await (await getStatus(get())).json();

    expect(body.data.totalPoints).toBe(140);
    expect(body.data.pointsSpent).toBe(100);
    expect(body.data.pointsBalance).toBe(40);
  });
});

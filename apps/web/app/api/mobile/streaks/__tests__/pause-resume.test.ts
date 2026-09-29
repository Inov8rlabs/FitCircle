/**
 * Pause / resume / engagement / history routes: real handlers, real service,
 * in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET as getHistory } from '../engagement/history/route';
import { POST as pause } from '../engagement/pause/route';
import { POST as resume } from '../engagement/resume/route';
import { GET as getEngagement } from '../engagement/route';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
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

function seedUser(opts: { paused?: boolean; pauseStart?: string | null; pauseEnd?: string | null; claims?: string[] } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: 2 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [
    {
      user_id: USER,
      current_streak: 3,
      longest_streak: 12,
      streak_freezes_available: 2,
      streak_freezes_used_this_week: 0,
      paused: opts.paused ?? false,
      pause_start_date: opts.pauseStart ?? null,
      pause_end_date: opts.pauseEnd ?? null,
      last_engagement_date: '2026-09-27',
      total_points: 40,
    },
  ]);
  for (const day of opts.claims ?? ['2026-09-25', '2026-09-26', '2026-09-27']) {
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day, claim_method: 'explicit', timezone: 'UTC', metadata: {} },
    ]);
  }
}

function post(path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { headers });

const streakRow = () => db.getRows('engagement_streaks')[0];

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

describe('POST /api/mobile/streaks/engagement/pause', () => {
  it('accepts resume_date as a date (Android) and stores the pause window', async () => {
    seedUser();

    const res = await pause(post('/api/mobile/streaks/engagement/pause', { resume_date: '2026-10-05' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Streak paused successfully');
    expect(body.pause_start_date).toBe(TODAY);
    expect(body.pause_end_date).toBe('2026-10-05');
    expect(streakRow()).toMatchObject({
      paused: true,
      pause_start_date: TODAY,
      pause_end_date: '2026-10-05',
    });
  });

  it('accepts resume_date as an ISO-8601 instant (iOS)', async () => {
    seedUser();

    const res = await pause(
      post(
        '/api/mobile/streaks/engagement/pause',
        { resume_date: '2026-10-05T17:23:11Z' },
        { 'x-client-timezone': 'America/Los_Angeles' }
      )
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pause_end_date).toBe('2026-10-05');
  });

  it('returns a data object the iOS and the old Android pause models can decode', async () => {
    seedUser();

    const body = await (
      await pause(post('/api/mobile/streaks/engagement/pause', { resume_date: '2026-10-05' }))
    ).json();

    // iOS PauseStreakResponse: success, pause_end_date, message.
    expect(body.data.success).toBe(true);
    expect(body.data.pause_end_date).toBe('2026-10-05');
    expect(body.data.message).toBe('Streak paused successfully');
    // Android (before 2026-09) PauseStreakResponse: paused, pause_end_date, freezes_available.
    expect(body.data.paused).toBe(true);
    expect(body.data.freezes_available).toBe(2);
    // Additional.
    expect(body.data.pause_start_date).toBe(TODAY);
    expect(body.data.current_streak).toBe(3);
  });

  it('computes the resume date from the old Android `days` field', async () => {
    seedUser();

    const body = await (await pause(post('/api/mobile/streaks/engagement/pause', { days: 14 }))).json();

    expect(body.success).toBe(true);
    expect(body.pause_end_date).toBe('2026-10-12');
    expect(streakRow().pause_end_date).toBe('2026-10-12');
  });

  it('caps `days` at 90', async () => {
    seedUser();

    const body = await (await pause(post('/api/mobile/streaks/engagement/pause', { days: 400 }))).json();

    expect(body.success).toBe(true);
    expect(body.pause_end_date).toBe('2026-12-27');
  });

  it('pauses for the maximum when the body is empty or absent, as before', async () => {
    seedUser();

    const res = await pause(post('/api/mobile/streaks/engagement/pause'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pause_end_date).toBe('2026-12-27');
  });

  it('accepts explicit nulls', async () => {
    seedUser();

    const res = await pause(
      post('/api/mobile/streaks/engagement/pause', { resume_date: null, reason: null, days: null })
    );

    expect(res.status).toBe(200);
    expect(streakRow().paused).toBe(true);
  });

  it('keeps the 400 and the wording for a resume date that is not in the future or too far', async () => {
    seedUser();

    const past = await pause(post('/api/mobile/streaks/engagement/pause', { resume_date: '2026-09-01' }));
    expect(past.status).toBe(400);
    expect((await past.json()).error).toBe('Resume date must be in the future');

    const far = await pause(post('/api/mobile/streaks/engagement/pause', { resume_date: '2027-06-01' }));
    const farBody = await far.json();
    expect(far.status).toBe(400);
    expect(farBody.error).toBe('Resume date cannot be more than 90 days in the future');
    expect(farBody.message).toBe(farBody.error);
    expect(farBody.code).toBe('PAUSE_TOO_LONG');

    expect(streakRow().paused).toBe(false);
  });

  it('keeps the 400 for a streak that is already paused', async () => {
    seedUser({ paused: true, pauseStart: '2026-09-20', pauseEnd: '2026-10-20' });

    const res = await pause(post('/api/mobile/streaks/engagement/pause', { resume_date: '2026-10-05' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ success: false, error: 'Streak is already paused', data: null });
    expect(streakRow().pause_start_date).toBe('2026-09-20');
  });
});

describe('POST /api/mobile/streaks/engagement/resume', () => {
  it('resumes, bridges the paused days and returns the refreshed streak', async () => {
    seedUser({
      paused: true,
      pauseStart: '2026-09-24',
      pauseEnd: '2026-10-20',
      claims: ['2026-09-21', '2026-09-22', '2026-09-23'],
    });

    const res = await resume(post('/api/mobile/streaks/engagement/resume'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Streak resumed successfully');
    // Same shape as GET /api/mobile/streaks/engagement.
    expect(body.data).toMatchObject({
      current_streak: 7,
      longest_streak: 12,
      freezes_available: 2,
      paused: false,
      pause_end_date: null,
      pause_start_date: null,
    });
    expect(streakRow().paused).toBe(false);
  });

  it('keeps the 400 for a streak that is not paused', async () => {
    seedUser();
    const res = await resume(post('/api/mobile/streaks/engagement/resume'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Streak is not currently paused');
  });
});

describe('GET /api/mobile/streaks/engagement', () => {
  it('reports pause_start_date next to the existing fields while paused', async () => {
    seedUser({ paused: true, pauseStart: '2026-09-20', pauseEnd: '2026-10-20' });

    const body = await (await getEngagement(get('/api/mobile/streaks/engagement'))).json();

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      current_streak: expect.any(Number),
      longest_streak: 12,
      freezes_available: 2,
      shields_unlimited: false,
      paused: true,
      pause_end_date: '2026-10-20',
      pause_start_date: '2026-09-20',
      last_engagement_date: '2026-09-27',
    });
  });

  it('reports pause_start_date null when the streak is not paused', async () => {
    seedUser();
    const body = await (await getEngagement(get('/api/mobile/streaks/engagement'))).json();
    expect(body.data.paused).toBe(false);
    expect(body.data.pause_start_date).toBeNull();
  });

  it('reports the shield price, and the XP balance once the spent ledger exists', async () => {
    seedUser();
    const before = await (await getEngagement(get('/api/mobile/streaks/engagement'))).json();
    expect(before.data.shield_price_xp).toBe(100);
    expect(before.data.xp_balance).toBeNull();

    streakRow().points_spent = 10;
    const after = await (await getEngagement(get('/api/mobile/streaks/engagement'))).json();
    expect(after.data.xp_balance).toBe(30);
  });
});

describe('GET /api/mobile/streaks/engagement/history', () => {
  it('keeps entries/total_days/total_activities and adds the paused days', async () => {
    seedUser({ paused: true, pauseStart: '2026-09-26', pauseEnd: '2026-10-20', claims: [] });
    // An earlier pause that was resumed left bridge rows behind.
    db.seed('streak_claims', [
      { user_id: USER, claim_date: '2026-09-10', claim_method: 'freeze', timezone: 'UTC', metadata: { source: 'streak_pause' } },
      { user_id: USER, claim_date: '2026-09-11', claim_method: 'freeze', timezone: 'UTC', metadata: { source: 'streak_pause' } },
      // A shield is not a pause.
      { user_id: USER, claim_date: '2026-09-15', claim_method: 'freeze', timezone: 'UTC', metadata: { shield_type: 'freeze' } },
    ]);
    db.seed('engagement_activities', [
      { user_id: USER, activity_date: '2026-09-20', activity_type: 'weight_log', reference_id: null },
      { user_id: USER, activity_date: '2026-09-20', activity_type: 'steps_log', reference_id: null },
    ]);

    const body = await (await getHistory(get('/api/mobile/streaks/engagement/history?days=30'))).json();

    expect(body.success).toBe(true);
    expect(body.data.entries).toEqual([
      { date: '2026-09-20', activities: ['weight_log', 'steps_log'], activity_count: 2 },
    ]);
    expect(body.data.total_days).toBe(1);
    expect(body.data.total_activities).toBe(2);
    expect(body.data.paused_days).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
    ]);
  });

  it('reports no paused days for a user who never paused', async () => {
    seedUser();
    const body = await (await getHistory(get('/api/mobile/streaks/engagement/history'))).json();
    expect(body.data.paused_days).toEqual([]);
  });

  it('falls back to 90 days for an unreadable days parameter', async () => {
    seedUser();
    const res = await getHistory(get('/api/mobile/streaks/engagement/history?days=abc'));
    expect(res.status).toBe(200);
  });
});

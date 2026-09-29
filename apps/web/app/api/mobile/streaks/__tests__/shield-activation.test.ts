/**
 * Shield activation without a date, and the claim route's tolerance.
 * Real handlers and services, in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { POST as claim } from '@/api/streaks/claim/route';
import { POST as activateFreeze } from '@/api/streaks/freeze/activate/route';
import { POST as startRecovery } from '@/api/streaks/recovery/start/route';
import { addDays } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as applyFreeze } from '../apply-freeze/route';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));

const USER = 'user-1';
// 09:00 in Los Angeles on 28 September.
const NOW = new Date('2026-09-28T16:00:00Z');
const TODAY = '2026-09-28';
const YESTERDAY = '2026-09-27';
const TZ = 'America/Los_Angeles';

let authedUser: { id: string } | null = { id: USER };
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));

let db: FakeSupabase;

function seedUser(opts: { shields?: number; claims?: string[] } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: opts.shields ?? 1 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0, metadata: {} },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [
    {
      user_id: USER,
      current_streak: 0,
      longest_streak: 0,
      streak_freezes_available: opts.shields ?? 1,
      paused: false,
      pause_start_date: null,
      pause_end_date: null,
      last_engagement_date: null,
    },
  ]);
  for (const day of opts.claims ?? []) {
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day, claim_method: 'explicit', timezone: TZ, metadata: {} },
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

const shieldsLeft = () =>
  db.getRows('streak_shields').reduce((sum, row) => sum + row.available_count, 0);
const freezeClaims = () =>
  db.getRows('streak_claims').filter(row => row.claim_method === 'freeze').map(row => row.claim_date);

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

describe('POST /api/streaks/freeze/activate', () => {
  it('protects yesterday when no date is given and yesterday was missed', async () => {
    seedUser({ claims: ['2026-09-25', '2026-09-26'] });

    const res = await activateFreeze(post('/api/streaks/freeze/activate', { timezone: TZ }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      shieldsRemaining: 0,
      unlimited: false,
      date: YESTERDAY,
      message: `Freeze activated for ${YESTERDAY}`,
    });
    expect(freezeClaims()).toEqual([YESTERDAY]);
  });

  it('uses the most recent missed day when yesterday is already claimed', async () => {
    seedUser({ claims: ['2026-09-24', '2026-09-26', YESTERDAY] });

    const body = await (
      await activateFreeze(post('/api/streaks/freeze/activate', { date: null, timezone: TZ }))
    ).json();

    expect(body.success).toBe(true);
    expect(body.date).toBe('2026-09-25');
    expect(freezeClaims()).toEqual(['2026-09-25']);
  });

  it("uses the user's yesterday, not the server's", async () => {
    // 28 September 23:30 in Los Angeles is 29 September in UTC.
    vi.setSystemTime(new Date('2026-09-29T06:30:00Z'));
    seedUser({ claims: ['2026-09-26'] });

    const viaBody = await (
      await activateFreeze(post('/api/streaks/freeze/activate', { timezone: TZ }))
    ).json();
    expect(viaBody.date).toBe(YESTERDAY);
  });

  it('falls back to the X-Client-Timezone header when the body has no timezone', async () => {
    vi.setSystemTime(new Date('2026-09-29T06:30:00Z'));
    seedUser({ claims: ['2026-09-26'] });

    const res = await activateFreeze(
      post('/api/streaks/freeze/activate', {}, { 'x-client-timezone': TZ })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.date).toBe(YESTERDAY);
  });

  it('works with no body at all', async () => {
    seedUser({ claims: ['2026-09-26'] });
    const res = await activateFreeze(post('/api/streaks/freeze/activate'));
    expect(res.status).toBe(200);
  });

  it('spends nothing when there is no missed day to protect', async () => {
    const window = [1, 2, 3, 4, 5, 6].map(n => addDays(TODAY, -n));
    seedUser({ claims: window });

    const res = await activateFreeze(post('/api/streaks/freeze/activate', { timezone: TZ }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('ALREADY_CLAIMED');
    expect(body.error.details).toEqual({ reason: 'NO_MISSED_DAY' });
    expect(shieldsLeft()).toBe(1);
  });

  it('keeps the rules for an explicit date: a past day is protected', async () => {
    seedUser({ claims: [YESTERDAY] });

    const res = await activateFreeze(
      post('/api/streaks/freeze/activate', { date: '2026-09-25', timezone: TZ })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.date).toBe('2026-09-25');
    expect(body.shieldsRemaining).toBe(0);
  });

  it('keeps the rules for an explicit date: today is refused with FUTURE_DATE', async () => {
    // This is what the iOS "Use Shield Now" button sends.
    seedUser({ claims: ['2026-09-26'] });

    const res = await activateFreeze(
      post('/api/streaks/freeze/activate', { date: TODAY, timezone: TZ })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('FUTURE_DATE');
    expect(shieldsLeft()).toBe(1);
    expect(freezeClaims()).toEqual([]);
  });

  it('keeps NO_SHIELDS_AVAILABLE with the upsell hint', async () => {
    seedUser({ shields: 0, claims: ['2026-09-26'] });

    const res = await activateFreeze(post('/api/streaks/freeze/activate', { timezone: TZ }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('NO_SHIELDS_AVAILABLE');
    expect(body.error.upsell).toBe('pro_unlimited_shields');
  });

  it('answers a malformed date with a readable validation message', async () => {
    seedUser();
    const res = await activateFreeze(
      post('/api/streaks/freeze/activate', { date: '27-09-2026', timezone: TZ })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/^date: /);
    expect(body.error.details).toHaveProperty('date');
  });
});

describe('POST /api/mobile/streaks/apply-freeze', () => {
  it('protects the explicit missedDate both clients send', async () => {
    seedUser({ claims: ['2026-09-25', '2026-09-26'] });

    const res = await applyFreeze(
      post('/api/mobile/streaks/apply-freeze', { missedDate: YESTERDAY }, { 'x-client-timezone': TZ })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      current_streak: 3,
      freezes_available: 0, // the one shield was spent
      paused: false,
      protected_date: YESTERDAY,
    });
    expect(freezeClaims()).toEqual([YESTERDAY]);
  });

  it('defaults to yesterday when no date is given and yesterday was missed', async () => {
    seedUser({ claims: ['2026-09-26'] });

    const body = await (
      await applyFreeze(post('/api/mobile/streaks/apply-freeze', { missedDate: null }, { 'x-client-timezone': TZ }))
    ).json();

    expect(body.success).toBe(true);
    expect(body.data.protected_date).toBe(YESTERDAY);
  });

  it('defaults to the most recent missed day when yesterday is claimed', async () => {
    seedUser({ claims: ['2026-09-24', '2026-09-26', YESTERDAY] });

    const body = await (
      await applyFreeze(post('/api/mobile/streaks/apply-freeze', undefined, { 'x-client-timezone': TZ }))
    ).json();

    expect(body.success).toBe(true);
    expect(body.data.protected_date).toBe('2026-09-25');
    expect(body.data.current_streak).toBe(4);
  });

  it('keeps DATE_HAS_ACTIVITY when nothing is missed', async () => {
    seedUser({ claims: [1, 2, 3, 4, 5, 6].map(n => addDays(TODAY, -n)) });

    const res = await applyFreeze(
      post('/api/mobile/streaks/apply-freeze', {}, { 'x-client-timezone': TZ })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('DATE_HAS_ACTIVITY');
    expect(shieldsLeft()).toBe(1);
  });
});

describe('POST /api/streaks/claim', () => {
  it('accepts claimDate: null, which Android sent on every claim', async () => {
    seedUser();

    const res = await claim(post('/api/streaks/claim', { claimDate: null, timezone: TZ }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.streakCount).toBe(1);
    expect(db.getRows('streak_claims')).toMatchObject([
      { claim_date: TODAY, claim_method: 'explicit', timezone: TZ },
    ]);
  });

  it('accepts the request without claimDate, as iOS sends it', async () => {
    seedUser({ claims: [YESTERDAY] });

    const res = await claim(post('/api/streaks/claim', { timezone: TZ }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.streakCount).toBe(2);
    expect(body.message).toBe('Streak claimed! Current streak: 2 days');
  });

  it('accepts an explicit past claimDate as a retroactive claim', async () => {
    seedUser();

    const res = await claim(post('/api/streaks/claim', { claimDate: YESTERDAY, timezone: TZ }));

    expect(res.status).toBe(200);
    expect(db.getRows('streak_claims')[0]).toMatchObject({
      claim_date: YESTERDAY,
      claim_method: 'retroactive',
    });
  });

  it('falls back to the header timezone when the body has none', async () => {
    vi.setSystemTime(new Date('2026-09-29T06:30:00Z'));
    seedUser();

    const res = await claim(
      post('/api/streaks/claim', { claimDate: null, timezone: null }, { 'x-client-timezone': TZ })
    );

    expect(res.status).toBe(200);
    expect(db.getRows('streak_claims')[0]).toMatchObject({ claim_date: TODAY, timezone: TZ });
  });

  it('keeps 409 ALREADY_CLAIMED', async () => {
    seedUser({ claims: [TODAY] });

    const res = await claim(post('/api/streaks/claim', { timezone: TZ }));

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ALREADY_CLAIMED');
  });

  it('answers a malformed claimDate with a readable validation message', async () => {
    seedUser();

    const res = await claim(post('/api/streaks/claim', { claimDate: 'today', timezone: TZ }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/^claimDate: /);
    expect(body.error.details).toHaveProperty('claimDate');
  });
});

describe('POST /api/streaks/recovery/start', () => {
  it('answers a validation error with a readable message', async () => {
    seedUser();

    const res = await startRecovery(
      post('/api/streaks/recovery/start', { brokenDate: YESTERDAY, recoveryType: null })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/^recoveryType: /);
  });
});

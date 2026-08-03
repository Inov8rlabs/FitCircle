/**
 * Route-level tests for the shield endpoints — real handlers, in-memory DB.
 * (This file previously contained only `expect(true)` placeholders.)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { GET as getShields } from '@/api/streaks/shields/route';
import { POST as activateFreeze } from '@/api/streaks/freeze/activate/route';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { SHIELD_RULES } from '@/lib/streaks/streak-config';
import { addDays, localToday } from '@/lib/streaks/streak-calculator';
import { makeStreakDb, type FakeSupabase } from '../../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));

const USER = 'user-1';
let db: FakeSupabase;
let authedUser: { id: string } | null = { id: USER };

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));

function seedUser(opts: { tier?: string; shields?: number; claims?: string[] } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: opts.tier ?? 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: opts.shields ?? 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [
    { user_id: USER, current_streak: 0, longest_streak: 0, streak_freezes_available: 0, paused: false },
  ]);
  for (const day of opts.claims ?? []) {
    db.seed('streak_claims', [
      { user_id: USER, claim_date: day, claim_method: 'explicit', timezone: 'UTC', metadata: {} },
    ]);
  }
}

function jsonRequest(url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db = makeStreakDb();
  authedUser = { id: USER };
  (createAdminSupabase as any).mockReturnValue(db);
});

describe('GET /api/streaks/shields', () => {
  it('rejects unauthenticated requests', async () => {
    authedUser = null;
    const res = await getShields(jsonRequest('/api/streaks/shields'));
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns shield counts, cap, and the unlimited flag', async () => {
    seedUser({ shields: 2 });
    const res = await getShields(jsonRequest('/api/streaks/shields'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.freezes).toBe(2);
    expect(body.unlimited).toBe(false);
    expect(body.cap).toBe(SHIELD_RULES.MAX_SHIELD_BALANCE);
    // Legacy decoders expect a date here — kept populated for compat.
    expect(typeof body.next_freeze_reset).toBe('string');
  });

  it('reports unlimited for Pro users', async () => {
    seedUser({ tier: 'premium', shields: 0 });
    const res = await getShields(jsonRequest('/api/streaks/shields'));
    const body = await res.json();
    expect(body.unlimited).toBe(true);
  });
});

describe('POST /api/streaks/freeze/activate', () => {
  const today = localToday('UTC');

  it('activates a freeze and reports remaining shields', async () => {
    seedUser({ shields: 2, claims: [addDays(today, -2), today] });
    const res = await activateFreeze(
      jsonRequest('/api/streaks/freeze/activate', { date: addDays(today, -1), timezone: 'UTC' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.shieldsRemaining).toBe(1);
    expect(body.unlimited).toBe(false);
  });

  it('returns 400 + NO_SHIELDS_AVAILABLE + upsell hint when a free user is out (the paywall moment)', async () => {
    seedUser({ shields: 0, claims: [addDays(today, -2)] });
    const res = await activateFreeze(
      jsonRequest('/api/streaks/freeze/activate', { date: addDays(today, -1), timezone: 'UTC' })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('NO_SHIELDS_AVAILABLE');
    expect(body.error.upsell).toBe('pro_unlimited_shields');
  });

  it('succeeds for Pro without decrementing, reporting a numeric sentinel for legacy decoders', async () => {
    seedUser({ tier: 'premium', shields: 1, claims: [addDays(today, -2)] });
    const res = await activateFreeze(
      jsonRequest('/api/streaks/freeze/activate', { date: addDays(today, -1), timezone: 'UTC' })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unlimited).toBe(true);
    expect(typeof body.shieldsRemaining).toBe('number');
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(1); // untouched
  });

  it('rejects shielding an already-claimed day without burning a shield', async () => {
    seedUser({ shields: 1, claims: [addDays(today, -1)] });
    const res = await activateFreeze(
      jsonRequest('/api/streaks/freeze/activate', { date: addDays(today, -1), timezone: 'UTC' })
    );
    expect(res.status).toBe(400);
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze');
    expect(freeze!.available_count).toBe(1);
  });
});

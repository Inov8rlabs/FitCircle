/**
 * Route-level tests for the daily-challenge endpoints: real handlers, real
 * service, in-memory database.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../../__tests__/helpers/fake-supabase';
import { POST as join } from '../[id]/join/route';
import { GET as getLeaderboard } from '../[id]/leaderboard/route';
import { GET as getProgress, POST as postProgress } from '../[id]/progress/route';

vi.mock('@/lib/supabase-admin');

const CHALLENGE = '11111111-1111-4111-8111-111111111111';
const OTHER_CHALLENGE = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let authedUser: { id: string } | null = { id: ME };
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));

let db: FakeSupabase;

function userId(n: number): string {
  return `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
}

function seedChallenge(goal = 10000) {
  db.seed('daily_challenges', [
    {
      id: CHALLENGE,
      challenge_date: '2026-09-28',
      template_id: null,
      is_custom: true,
      custom_name: 'Step It Up',
      custom_description: 'Hit the goal',
      custom_goal_amount: goal,
      custom_unit: 'steps',
      participant_count: 0,
      completion_count: 0,
      created_at: '2026-09-28T00:00:00Z',
    },
  ]);
}

function seedParticipant(user: string, progress: number, name = 'Someone', challenge = CHALLENGE) {
  db.seed('daily_challenge_participants', [
    {
      id: `p-${user}-${challenge}`,
      daily_challenge_id: challenge,
      user_id: user,
      progress,
      is_completed: false,
      completed_at: null,
      joined_at: '2026-09-28T08:00:00Z',
      // The real query embeds the profile; the fake returns rows as stored.
      profiles: { display_name: name, avatar_url: null },
    },
  ]);
  db.seed('profiles', [{ id: user, display_name: name, avatar_url: null }]);
}

function request(path: string, init?: { method?: string; body?: unknown; rawBody?: string }): NextRequest {
  const hasBody = init?.body !== undefined || init?.rawBody !== undefined;
  return new NextRequest(`http://localhost${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    body: hasBody ? init?.rawBody ?? JSON.stringify(init?.body) : undefined,
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  authedUser = { id: ME };
  db = new FakeSupabase({
    daily_challenges: { uniqueKey: ['id'] },
    daily_challenge_participants: { uniqueKey: ['daily_challenge_id', 'user_id'] },
    challenge_templates: {},
    profiles: { uniqueKey: ['id'] },
  });
  (createAdminSupabase as any).mockReturnValue(db);
});

describe('GET /api/mobile/challenges/daily/[id]/progress', () => {
  it('reads the participant by daily_challenge_id and returns the real progress and rank', async () => {
    seedChallenge();
    seedParticipant(userId(1), 9000);
    seedParticipant(userId(2), 7000);
    seedParticipant(ME, 5000);
    seedParticipant(userId(3), 100);
    // Same user on another challenge must not leak into this one.
    seedParticipant(ME, 99999, 'Me', OTHER_CHALLENGE);

    const res = await getProgress(request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`), params(CHALLENGE));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.challenge_id).toBe(CHALLENGE);
    expect(body.data.user_progress).toBe(5000);
    expect(body.data.is_completed).toBe(false);
    expect(body.data.rank).toBe(3);
    expect(body.data.user_joined).toBe(true);
  });

  it('keeps the response shape the clients decode', async () => {
    seedChallenge();
    seedParticipant(ME, 12);

    const res = await getProgress(request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`), params(CHALLENGE));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'success']);
    expect(body.error).toBeNull();
    expect(typeof body.data.challenge_id).toBe('string');
    expect(typeof body.data.user_progress).toBe('number');
    expect(typeof body.data.is_completed).toBe('boolean');
    expect(Number.isInteger(body.data.rank)).toBe(true);
  });

  it('answers zeros (not 404) for a user who has not joined', async () => {
    seedChallenge();
    seedParticipant(userId(1), 9000);

    const res = await getProgress(request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`), params(CHALLENGE));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      challenge_id: CHALLENGE,
      user_progress: 0,
      is_completed: false,
      rank: 0,
      user_joined: false,
    });
  });

  it('shares a rank between ties', async () => {
    seedChallenge();
    seedParticipant(userId(1), 500);
    seedParticipant(ME, 500);

    const res = await getProgress(request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`), params(CHALLENGE));
    expect((await res.json()).data.rank).toBe(1);
  });

  it('rejects an id that is not a uuid', async () => {
    const res = await getProgress(request('/api/mobile/challenges/daily/nope/progress'), params('nope'));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Invalid challenge id');
  });

  it('returns 401 without a valid token', async () => {
    authedUser = null;
    const res = await getProgress(request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`), params(CHALLENGE));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/mobile/challenges/daily/[id]/progress', () => {
  it('accepts the existing request shape and keeps the existing response keys', async () => {
    seedChallenge(10000);
    seedParticipant(ME, 0);

    const res = await postProgress(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`, { method: 'POST', body: { progress: 4000 } }),
      params(CHALLENGE)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.progress).toBe(4000);
    expect(body.data.is_completed).toBe(false);
    expect(body.data.completed_at).toBeNull();
    // Additional keys, same names as the GET response.
    expect(body.data.challenge_id).toBe(CHALLENGE);
    expect(body.data.user_progress).toBe(4000);
    expect(body.data.rank).toBe(1);
  });

  it('completes the challenge at the goal and counts the completion once', async () => {
    seedChallenge(50);
    seedParticipant(ME, 0);
    const post = (progress: number) =>
      postProgress(
        request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`, { method: 'POST', body: { progress } }),
        params(CHALLENGE)
      );

    const first = await (await post(50)).json();
    expect(first.data.is_completed).toBe(true);
    expect(first.data.completed_at).toEqual(expect.any(String));
    await vi.waitFor(() => expect(db.getRows('daily_challenges')[0].completion_count).toBe(1));

    const second = await (await post(60)).json();
    expect(second.data.is_completed).toBe(true);
    expect(second.data.completed_at).toBe(first.data.completed_at);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(db.getRows('daily_challenges')[0].completion_count).toBe(1);
  });

  it('stores a value between 0 and 1 as sent: no fraction guessing', async () => {
    // 8 glasses of water: "1" from Android is one glass, not 100%.
    seedChallenge(8);
    seedParticipant(ME, 0);

    const res = await postProgress(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`, { method: 'POST', body: { progress: 0.5 } }),
      params(CHALLENGE)
    );
    const body = await res.json();

    expect(body.data.progress).toBe(0.5);
    expect(body.data.is_completed).toBe(false);
    expect(db.getRows('daily_challenge_participants')[0].progress).toBe(0.5);
  });

  it('answers a validation error with code, message and details', async () => {
    seedChallenge();
    seedParticipant(ME, 0);

    for (const bad of [{ progress: null }, {}, { progress: -1 }, { progress: '12' }]) {
      const res = await postProgress(
        request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`, { method: 'POST', body: bad }),
        params(CHALLENGE)
      );
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/^progress: /);
      expect(Array.isArray(body.error.details)).toBe(true);
    }
  });

  it('answers 400 instead of 500 for an empty body', async () => {
    seedChallenge();
    seedParticipant(ME, 0);
    const res = await postProgress(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`, { method: 'POST', rawBody: '' }),
      params(CHALLENGE)
    );
    expect(res.status).toBe(400);
  });

  it('keeps NOT_PARTICIPANT and NOT_FOUND', async () => {
    seedChallenge();
    const notJoined = await postProgress(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/progress`, { method: 'POST', body: { progress: 1 } }),
      params(CHALLENGE)
    );
    expect(notJoined.status).toBe(400);
    expect((await notJoined.json()).error.code).toBe('NOT_PARTICIPANT');

    const missing = await postProgress(
      request(`/api/mobile/challenges/daily/${OTHER_CHALLENGE}/progress`, { method: 'POST', body: { progress: 1 } }),
      params(OTHER_CHALLENGE)
    );
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/mobile/challenges/daily/[id]/leaderboard', () => {
  it('adds a rank to every row and leaves the existing fields alone', async () => {
    seedChallenge();
    seedParticipant(userId(1), 9000, 'Alice');
    seedParticipant(userId(2), 7000, 'Bob');
    seedParticipant(userId(3), 7000, 'Carol');
    seedParticipant(userId(4), 10, 'Dave');

    const res = await getLeaderboard(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/leaderboard`),
      params(CHALLENGE)
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.map((row: any) => row.rank)).toEqual([1, 2, 2, 4]);
    expect(body.data[0]).toEqual({
      user_id: userId(1),
      display_name: 'Alice',
      avatar_url: null,
      progress: 9000,
      is_completed: false,
      completed_at: null,
      rank: 1,
    });
  });

  it("includes the requesting user's row and rank when they are outside the top `limit`", async () => {
    seedChallenge();
    for (let n = 1; n <= 5; n++) seedParticipant(userId(n), 1000 * (10 - n), `User ${n}`);
    seedParticipant(ME, 5, 'Me');

    const res = await getLeaderboard(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/leaderboard?limit=3`),
      params(CHALLENGE)
    );
    const body = await res.json();

    expect(body.data).toHaveLength(3);
    expect(body.data.some((row: any) => row.user_id === ME)).toBe(false);
    expect(body.user_rank).toBe(6);
    expect(body.user_entry).toEqual({
      user_id: ME,
      display_name: 'Me',
      avatar_url: null,
      progress: 5,
      is_completed: false,
      completed_at: null,
      rank: 6,
    });
    expect(body.total_participants).toBe(6);
  });

  it('reports the same row when the user is inside the list', async () => {
    seedChallenge();
    seedParticipant(userId(1), 9000, 'Alice');
    seedParticipant(ME, 8000, 'Me');

    const body = await (
      await getLeaderboard(request(`/api/mobile/challenges/daily/${CHALLENGE}/leaderboard`), params(CHALLENGE))
    ).json();

    expect(body.user_rank).toBe(2);
    expect(body.user_entry).toEqual(body.data[1]);
  });

  it('reports null for a user who has not joined', async () => {
    seedChallenge();
    seedParticipant(userId(1), 9000, 'Alice');

    const body = await (
      await getLeaderboard(request(`/api/mobile/challenges/daily/${CHALLENGE}/leaderboard`), params(CHALLENGE))
    ).json();

    expect(body.user_entry).toBeNull();
    expect(body.user_rank).toBeNull();
    expect(body.total_participants).toBe(1);
  });

  it('falls back to 20 rows for an unreadable limit and caps at 100', async () => {
    seedChallenge();
    for (let n = 1; n <= 25; n++) seedParticipant(userId(n), 1000 - n, `User ${n}`);

    const unreadable = await (
      await getLeaderboard(
        request(`/api/mobile/challenges/daily/${CHALLENGE}/leaderboard?limit=abc`),
        params(CHALLENGE)
      )
    ).json();
    expect(unreadable.data).toHaveLength(20);

    const huge = await (
      await getLeaderboard(
        request(`/api/mobile/challenges/daily/${CHALLENGE}/leaderboard?limit=5000`),
        params(CHALLENGE)
      )
    ).json();
    expect(huge.data).toHaveLength(25);
  });
});

describe('POST /api/mobile/challenges/daily/[id]/join', () => {
  it('returns the participant row plus challenge_id, joined and participant_count', async () => {
    seedChallenge();
    seedParticipant(userId(1), 10);

    const res = await join(
      request(`/api/mobile/challenges/daily/${CHALLENGE}/join`, { method: 'POST' }),
      params(CHALLENGE)
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({
      daily_challenge_id: CHALLENGE,
      user_id: ME,
      progress: 0,
      is_completed: false,
      challenge_id: CHALLENGE,
      joined: true,
      participant_count: 2,
    });
  });

  it('is idempotent', async () => {
    seedChallenge();
    const call = () =>
      join(request(`/api/mobile/challenges/daily/${CHALLENGE}/join`, { method: 'POST' }), params(CHALLENGE));

    await call();
    const again = await call();

    expect(again.status).toBe(201);
    expect((await again.json()).data.participant_count).toBe(1);
    expect(db.getRows('daily_challenge_participants')).toHaveLength(1);
  });
});

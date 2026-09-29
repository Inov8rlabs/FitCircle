import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChallengeFakeDb,
  getChallengeDb,
  setChallengeDb,
} from '@/lib/services/__tests__/circle-challenge-fake-db';

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => getChallengeDb().client(),
}));

// Same guard the sibling challenge routes use: a Bearer token (mobile) or a session
// cookie (web). Here "Bearer <user id>" signs that user in; anything else is refused.
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ') || header.length <= 'Bearer '.length) throw new Error('Unauthorized');
    return { id: header.slice('Bearer '.length) };
  },
}));

import { DELETE } from '../[logId]/route';
import { GET, POST } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CHALLENGE = '33333333-3333-4333-8333-333333333333';
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const P_ANA = 'a0000000-0000-4000-8000-000000000001';
const P_BEN = 'b0000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-09-28T12:00:00.000Z');

let db: ChallengeFakeDb;

const base = `http://localhost/api/fitcircles/${CIRCLE}/challenges/${CHALLENGE}/logs`;
const ctx = (circleId = CIRCLE, challengeId = CHALLENGE) => ({
  params: Promise.resolve({ id: circleId, challengeId }),
});

function request(method: string, url: string, user: string | null, body?: unknown, rawBody?: string) {
  const headers: Record<string, string> = {};
  if (user) headers.Authorization = `Bearer ${user}`;
  const payload = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, body: payload }) as any;
}

const post = (body: unknown, user: string | null = ANA, context = ctx()) =>
  POST(request('POST', base, user, body), context);

const del = (logId: string, user: string | null = ANA, circleId = CIRCLE, challengeId = CHALLENGE) =>
  DELETE(request('DELETE', `${base}/${logId}`, user), {
    params: Promise.resolve({ id: circleId, challengeId, logId }),
  });

function expectErrorEnvelope(body: any, code: string) {
  expect(body.success).toBe(false);
  expect(body.data).toBeNull();
  expect(body.error.code).toBe(code);
  // Android's ApiError requires both as non-null strings.
  expect(typeof body.error.code).toBe('string');
  expect(typeof body.error.message).toBe('string');
  expect(body.error.message.length).toBeGreaterThan(0);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  db = new ChallengeFakeDb();
  setChallengeDb(db);
  db.tables.challenges.push({
    id: CHALLENGE,
    fitcircle_id: CIRCLE,
    creator_id: ANA,
    name: '500 Pushups',
    category: 'strength',
    goal_amount: 500,
    unit: 'reps',
    is_open: true,
    status: 'active',
    starts_at: '2026-09-27T10:00:00.000Z',
    ends_at: '2026-10-08T10:00:00.000Z',
    participant_count: 2,
  });
  for (const [id, userId] of [[P_ANA, ANA], [P_BEN, BEN]]) {
    db.tables.fitcircle_members.push({ id: `m-${userId}`, fitcircle_id: CIRCLE, user_id: userId, status: 'active' });
    db.tables.challenge_participants.push({
      id,
      challenge_id: CHALLENGE,
      user_id: userId,
      fitcircle_id: CIRCLE,
      status: 'active',
      cumulative_total: 0,
      today_total: 0,
      today_date: '2026-09-27',
      current_streak: 0,
      longest_streak: 0,
      last_logged_at: null,
      log_count: 0,
      rank: null,
      goal_completion_pct: 0,
      milestones_achieved: {},
      joined_at: '2026-09-27T10:00:00.000Z',
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('authentication (all three routes)', () => {
  it('answers 401 UNAUTHORIZED without a bearer token and writes nothing', async () => {
    const responses = [
      await GET(request('GET', base, null), ctx()),
      await post({ amount: 10 }, null),
      await del('some-log', null),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      expectErrorEnvelope(await res.json(), 'UNAUTHORIZED');
    }
    expect(db.tables.challenge_logs).toHaveLength(0);
  });

  it('never takes the user from the body', async () => {
    const res = await post({ amount: 10, user_id: BEN, userId: BEN, participant_id: P_BEN });
    expect(res.status).toBe(201);
    expect(db.tables.challenge_logs[0]).toMatchObject({ user_id: ANA, participant_id: P_ANA });
  });

  it('answers 403 for a signed-in user outside the circle', async () => {
    for (const res of [await GET(request('GET', base, OUTSIDER), ctx()), await post({ amount: 10 }, OUTSIDER)]) {
      expect(res.status).toBe(403);
      expectErrorEnvelope(await res.json(), 'FORBIDDEN');
    }
  });
});

describe('POST .../logs', () => {
  it('accepts the body iOS and the web app send (note omitted) and returns the log result', async () => {
    const res = await post({ amount: 25 });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toEqual({
      log: {
        id: expect.any(String),
        challenge_id: CHALLENGE,
        participant_id: P_ANA,
        user_id: ANA,
        fitcircle_id: CIRCLE,
        amount: 25,
        note: null,
        logged_at: NOW.toISOString(),
        log_date: '2026-09-28',
        created_at: expect.any(String),
      },
      updated_participant: {
        cumulative_total: 25,
        today_total: 25,
        rank: 1,
        goal_completion_pct: 5,
        current_streak: 1,
      },
      rank_changed: true,
      old_rank: null,
      new_rank: 1,
      milestone_reached: null,
      passed_users: [],
    });
  });

  it('accepts a note', async () => {
    const res = await post({ amount: 25, note: 'morning set' });
    expect(res.status).toBe(201);
    expect((await res.json()).data.log.note).toBe('morning set');
  });

  it('accepts an explicit null note (Android serializes absent values as null)', async () => {
    const res = await post({ amount: 25, note: null });
    expect(res.status).toBe(201);
    expect((await res.json()).data.log.note).toBeNull();
  });

  it('accepts a numeric string and a decimal amount', async () => {
    expect((await (await post({ amount: '12.5' })).json()).data.log.amount).toBe(12.5);
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    expect((await (await post({ amount: 0.5 })).json()).data.log.amount).toBe(0.5);
  });

  it('accepts a long note and stores the first 80 characters', async () => {
    const res = await post({ amount: 5, note: 'n'.repeat(300) });
    expect(res.status).toBe(201);
    expect((await res.json()).data.log.note).toHaveLength(80);
  });

  it('ignores a date sent by the client: the server assigns the day', async () => {
    const res = await post({ amount: 5, log_date: '2026-01-01', logged_at: '2026-01-01T00:00:00Z' });
    expect(res.status).toBe(201);
    expect((await res.json()).data.log).toMatchObject({ log_date: '2026-09-28', logged_at: NOW.toISOString() });
  });

  it('accepts the UPPERCASE uuids iOS puts in the path', async () => {
    const res = await post({ amount: 5 }, ANA, ctx(CIRCLE.toUpperCase(), CHALLENGE.toUpperCase()));
    expect(res.status).toBe(201);
  });

  it.each([
    ['zero', { amount: 0 }],
    ['negative', { amount: -5 }],
    ['above the maximum', { amount: 10000.5 }],
    ['not a number', { amount: 'lots' }],
    ['missing', {}],
    ['null', { amount: null }],
    ['a boolean', { amount: true }],
    ['rounds to zero', { amount: 0.001 }],
    ['note of the wrong type', { amount: 5, note: 42 }],
    ['note far too long', { amount: 5, note: 'n'.repeat(501) }],
  ])('rejects an invalid body: %s', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expectErrorEnvelope(await res.json(), 'VALIDATION_ERROR');
    expect(db.tables.challenge_logs).toHaveLength(0);
  });

  it('explains a validation failure in error.message and keeps details an object', async () => {
    const body = await (await post({ amount: -5 })).json();
    expect(body.error.message).toBe('amount: Amount must be greater than 0');
    expect(body.error.details).toEqual({ amount: 'Amount must be greater than 0' });
  });

  it('answers 400 for a body that is not JSON and for an empty body', async () => {
    const notJson = await POST(request('POST', base, ANA, undefined, '{amount'), ctx());
    expect(notJson.status).toBe(400);
    expectErrorEnvelope(await notJson.json(), 'VALIDATION_ERROR');

    const empty = await POST(request('POST', base, ANA), ctx());
    expect(empty.status).toBe(400);
    expectErrorEnvelope(await empty.json(), 'VALIDATION_ERROR');
  });

  it('answers 409 DUPLICATE_DETECTED for a repeat within a minute', async () => {
    expect((await post({ amount: 20 })).status).toBe(201);
    const res = await post({ amount: 20 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expectErrorEnvelope(body, 'DUPLICATE_DETECTED');
    expect(db.tables.challenge_logs).toHaveLength(1);
  });

  it('answers 404 for a challenge that is not in this circle', async () => {
    const res = await post({ amount: 5 }, ANA, ctx(CIRCLE, '99999999-9999-4999-8999-999999999999'));
    expect(res.status).toBe(404);
    expectErrorEnvelope(await res.json(), 'NOT_FOUND');
  });

  it('answers 500 without echoing the database error', async () => {
    const client = db.client();
    vi.spyOn(db, 'client').mockImplementation(() => ({
      from: (table: string) => {
        if (table === 'challenge_logs') throw new Error('connection to 10.0.0.5 refused: password=hunter2');
        return client.from(table);
      },
    }));
    const res = await post({ amount: 5 });
    expect(res.status).toBe(500);
    const body = await res.json();
    expectErrorEnvelope(body, 'INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});

describe('GET .../logs', () => {
  beforeEach(() => {
    for (let i = 0; i < 5; i++) {
      db.tables.challenge_logs.push({
        id: `log-${i}`,
        challenge_id: CHALLENGE,
        participant_id: P_ANA,
        user_id: ANA,
        fitcircle_id: CIRCLE,
        amount: i + 1,
        note: null,
        logged_at: `2026-09-28T0${i}:00:00.000Z`,
        log_date: '2026-09-28',
        created_at: `2026-09-28T0${i}:00:00.000Z`,
      });
    }
    db.tables.challenge_logs.push({
      id: 'ben-log',
      challenge_id: CHALLENGE,
      participant_id: P_BEN,
      user_id: BEN,
      fitcircle_id: CIRCLE,
      amount: 99,
      note: null,
      logged_at: '2026-09-28T09:00:00.000Z',
      log_date: '2026-09-28',
      created_at: '2026-09-28T09:00:00.000Z',
    });
  });

  const get = async (query = '', user: string = ANA) => {
    const res = await GET(request('GET', `${base}${query}`, user), ctx());
    return { res, body: await res.json() };
  };

  it('returns the caller’s logs as an array in data, newest first, with every field the apps decode', async () => {
    const { res, body } = await get('?limit=50');
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.map((l: any) => l.amount)).toEqual([5, 4, 3, 2, 1]);
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ['amount', 'challenge_id', 'created_at', 'fitcircle_id', 'id', 'log_date', 'logged_at', 'note', 'participant_id', 'user_id'].sort()
    );
  });

  it('honours limit and offset, and clamps a limit that is out of range', async () => {
    expect((await get('?limit=2')).body.data.map((l: any) => l.amount)).toEqual([5, 4]);
    expect((await get('?limit=2&offset=4')).body.data.map((l: any) => l.amount)).toEqual([1]);
    expect((await get('?limit=0')).body.data).toHaveLength(1);
    expect((await get('?limit=100000')).body.data).toHaveLength(5);
    expect((await get('?limit=abc&offset=-3')).body.data).toHaveLength(5);
    expect((await get('')).body.data).toHaveLength(5);
  });

  it('is an empty list, not an error, for a member who has not joined the challenge', async () => {
    const CARA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    db.tables.fitcircle_members.push({ id: 'm-cara', fitcircle_id: CIRCLE, user_id: CARA, status: 'active' });
    const { res, body } = await get('', CARA);
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe('DELETE .../logs/[logId]', () => {
  it('deletes the caller’s log, answers with data null and updates progress', async () => {
    const first = (await (await post({ amount: 100 })).json()).data.log;
    vi.setSystemTime(new Date(NOW.getTime() + 5000));
    await post({ amount: 40 });

    const res = await del(first.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: null, error: null });

    expect(db.tables.challenge_logs.map((l) => l.amount)).toEqual([40]);
    expect(db.tables.challenge_participants.find((p) => p.id === P_ANA)).toMatchObject({
      cumulative_total: 40,
      today_total: 40,
      log_count: 1,
      goal_completion_pct: 8,
    });
  });

  it('accepts the UPPERCASE ids iOS puts in the path', async () => {
    db.tables.challenge_logs.push({
      id: 'abcdef00-0000-4000-8000-000000000001',
      challenge_id: CHALLENGE,
      participant_id: P_ANA,
      user_id: ANA,
      fitcircle_id: CIRCLE,
      amount: 10,
      note: null,
      logged_at: NOW.toISOString(),
      log_date: '2026-09-28',
    });
    const res = await del('ABCDEF00-0000-4000-8000-000000000001', ANA, CIRCLE.toUpperCase(), CHALLENGE.toUpperCase());
    expect(res.status).toBe(200);
    expect(db.tables.challenge_logs).toHaveLength(0);
  });

  it('answers 403 for someone else’s log and keeps it', async () => {
    const log = (await (await post({ amount: 100 }, BEN)).json()).data.log;
    const res = await del(log.id, ANA);
    expect(res.status).toBe(403);
    expectErrorEnvelope(await res.json(), 'FORBIDDEN');
    expect(db.tables.challenge_logs).toHaveLength(1);
  });

  it('answers 404 for an unknown log and 400 LOG_LOCKED for a log of an earlier day', async () => {
    const missing = await del('99999999-9999-4999-8999-999999999999');
    expect(missing.status).toBe(404);
    expectErrorEnvelope(await missing.json(), 'NOT_FOUND');

    db.tables.challenge_logs.push({
      id: 'old-log',
      challenge_id: CHALLENGE,
      participant_id: P_ANA,
      user_id: ANA,
      fitcircle_id: CIRCLE,
      amount: 10,
      note: null,
      logged_at: '2026-09-27T12:00:00.000Z',
      log_date: '2026-09-27',
    });
    const locked = await del('old-log');
    expect(locked.status).toBe(400);
    expectErrorEnvelope(await locked.json(), 'LOG_LOCKED');
    expect(db.tables.challenge_logs).toHaveLength(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChallengeError, ChallengeService } from '../circle-challenge-service';

import { ChallengeFakeDb, getChallengeDb, setChallengeDb } from './circle-challenge-fake-db';

// Hoisted above the imports by vitest; the factory only runs when the service
// asks for a client, by which time the fake db module is loaded.
vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => getChallengeDb().client(),
}));

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const OTHER_CIRCLE = '22222222-2222-4222-8222-222222222222';
const CHALLENGE = '33333333-3333-4333-8333-333333333333';
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MEMBER_NOT_JOINED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P_ANA = 'a0000000-0000-4000-8000-000000000001';
const P_BEN = 'b0000000-0000-4000-8000-000000000002';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const TODAY = '2026-09-28';

let db: ChallengeFakeDb;

function participant(id: string, userId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    challenge_id: CHALLENGE,
    user_id: userId,
    fitcircle_id: CIRCLE,
    invited_by: null,
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
    created_at: '2026-09-27T10:00:00.000Z',
    updated_at: '2026-09-27T10:00:00.000Z',
    ...overrides,
  };
}

function seedLog(participantId: string, userId: string, amount: number, loggedAt: string, note: string | null = null) {
  const row = {
    id: `log-${db.tables.challenge_logs.length + 1}`,
    challenge_id: CHALLENGE,
    participant_id: participantId,
    user_id: userId,
    fitcircle_id: CIRCLE,
    amount,
    note,
    logged_at: loggedAt,
    log_date: loggedAt.slice(0, 10),
    created_at: loggedAt,
  };
  db.tables.challenge_logs.push(row);
  return row;
}

const challengeRow = () => db.tables.challenges.find((c) => c.id === CHALLENGE)!;
const participantRow = (id: string) => db.tables.challenge_participants.find((p) => p.id === id)!;

async function expectChallengeError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ChallengeError);
  expect((error as ChallengeError).code).toBe(code);
  expect((error as ChallengeError).status).toBe(status);
  return error as ChallengeError;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  db = new ChallengeFakeDb();
  setChallengeDb(db);

  db.tables.challenges.push({
    id: CHALLENGE,
    fitcircle_id: CIRCLE,
    creator_id: ANA,
    template_id: null,
    name: '500 Pushups',
    description: null,
    category: 'strength',
    goal_amount: 500,
    unit: 'reps',
    logging_prompt: null,
    is_open: true,
    status: 'active',
    starts_at: '2026-09-27T10:00:00.000Z',
    ends_at: '2026-10-08T10:00:00.000Z',
    participant_count: 2,
    winner_user_id: null,
    created_at: '2026-09-27T10:00:00.000Z',
    updated_at: '2026-09-27T10:00:00.000Z',
  });
  for (const userId of [ANA, BEN, MEMBER_NOT_JOINED]) {
    db.tables.fitcircle_members.push({ id: `m-${userId}`, fitcircle_id: CIRCLE, user_id: userId, status: 'active' });
  }
  db.tables.fitcircle_members.push({ id: 'm-out', fitcircle_id: OTHER_CIRCLE, user_id: OUTSIDER, status: 'active' });
  db.tables.challenge_participants.push(participant(P_ANA, ANA), participant(P_BEN, BEN));
  db.tables.profiles.push({ id: ANA, display_name: 'Ana', avatar_url: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ChallengeService.logActivity', () => {
  it('stores the log with the server day and returns the shape the clients decode', async () => {
    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 25, note: 'morning set' }, CIRCLE);

    // iOS LogActivityResult / Android LogActivityResult: every key is required.
    expect(Object.keys(result).sort()).toEqual(
      ['log', 'milestone_reached', 'new_rank', 'old_rank', 'passed_users', 'rank_changed', 'updated_participant'].sort()
    );
    expect(result.log).toMatchObject({
      challenge_id: CHALLENGE,
      participant_id: P_ANA,
      user_id: ANA,
      fitcircle_id: CIRCLE,
      amount: 25,
      note: 'morning set',
      log_date: TODAY,
      logged_at: NOW.toISOString(),
    });
    expect(typeof result.log.id).toBe('string');
    expect(result.updated_participant).toEqual({
      cumulative_total: 25,
      today_total: 25,
      rank: 1,
      goal_completion_pct: 5,
      current_streak: 1,
    });
    expect(result.new_rank).toBe(1);
    expect(result.passed_users).toEqual([]);
    expect(result.milestone_reached).toBeNull();
  });

  it('keeps the stored participant row consistent with the logs', async () => {
    seedLog(P_ANA, ANA, 100, '2026-09-27T18:00:00.000Z');
    await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 30 }, CIRCLE);
    vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
    await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20.5 }, CIRCLE);

    expect(participantRow(P_ANA)).toMatchObject({
      cumulative_total: 150.5,
      today_total: 50.5,
      today_date: TODAY,
      log_count: 3,
      goal_completion_pct: 30.1,
      current_streak: 2,
      longest_streak: 2,
      last_logged_at: '2026-09-28T15:00:00.000Z',
      rank: 1,
    });
  });

  it('repairs a participant row that had drifted from its logs', async () => {
    Object.assign(participantRow(P_ANA), { cumulative_total: 9999, log_count: 77, goal_completion_pct: 100 });
    seedLog(P_ANA, ANA, 40, '2026-09-27T18:00:00.000Z');

    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 10 }, CIRCLE);

    expect(result.updated_participant.cumulative_total).toBe(50);
    expect(participantRow(P_ANA)).toMatchObject({ cumulative_total: 50, log_count: 2, goal_completion_pct: 10 });
  });

  it('caps the completion percentage at 100', async () => {
    seedLog(P_ANA, ANA, 480, '2026-09-27T18:00:00.000Z');
    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 300 }, CIRCLE);
    expect(result.updated_participant.cumulative_total).toBe(780);
    expect(result.updated_participant.goal_completion_pct).toBe(100);
    expect(participantRow(P_ANA).goal_completion_pct).toBe(100);
  });

  it('reports the rank change and who was overtaken', async () => {
    seedLog(P_BEN, BEN, 100, '2026-09-27T18:00:00.000Z');
    Object.assign(participantRow(P_BEN), { cumulative_total: 100, rank: 1, goal_completion_pct: 20 });
    Object.assign(participantRow(P_ANA), { rank: 2 });

    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 150 }, CIRCLE);

    expect(result).toMatchObject({ rank_changed: true, old_rank: 2, new_rank: 1, passed_users: [BEN] });
    expect(participantRow(P_ANA).rank).toBe(1);
    expect(participantRow(P_BEN).rank).toBe(2);

    const leaderboard = await ChallengeService.getLeaderboard(CHALLENGE, ANA);
    expect(leaderboard.map((e) => [e.user_id, e.rank, e.cumulative_total, e.goal_completion_pct, e.gap_to_next])).toEqual([
      [ANA, 1, 150, 30, null],
      [BEN, 2, 100, 20, 50],
    ]);
  });

  it('reports the milestone that was crossed, as "NN%"', async () => {
    seedLog(P_ANA, ANA, 100, '2026-09-27T18:00:00.000Z');
    Object.assign(participantRow(P_ANA), { cumulative_total: 100, goal_completion_pct: 20 });

    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 30 }, CIRCLE);

    expect(result.milestone_reached).toBe('25%');
    expect(participantRow(P_ANA).milestones_achieved).toEqual({ milestone_25: true });
  });

  it('cuts a long note to the 80 characters the column allows', async () => {
    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5, note: `  ${'n'.repeat(200)}  ` }, CIRCLE);
    expect(result.log.note).toHaveLength(80);
  });

  it('rounds the amount to 2 decimals and rejects one that rounds to zero', async () => {
    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 2.345 }, CIRCLE);
    expect(result.log.amount).toBe(2.35);

    await expectChallengeError(
      ChallengeService.logActivity(CHALLENGE, ANA, { amount: 0.004 }, CIRCLE),
      'VALIDATION_ERROR',
      400
    );
    await expectChallengeError(
      ChallengeService.logActivity(CHALLENGE, ANA, { amount: 10001 }, CIRCLE),
      'VALIDATION_ERROR',
      400
    );
  });

  it('reads more than one page of logs (PostgREST returns at most 1000 rows)', async () => {
    for (let i = 0; i < 1500; i++) {
      seedLog(P_ANA, ANA, 0.1, new Date(Date.UTC(2026, 8, 27, 10, 0, i)).toISOString());
    }
    db.tables.challenges[0].goal_amount = 1000;

    const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 1 }, CIRCLE);

    expect(result.updated_participant.cumulative_total).toBe(151);
    expect(participantRow(P_ANA).log_count).toBe(1501);
    expect(result.updated_participant.goal_completion_pct).toBe(15.1);
  });

  describe('who may log', () => {
    it('refuses a user who is not a member of the circle', async () => {
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, OUTSIDER, { amount: 5 }, CIRCLE),
        'FORBIDDEN',
        403
      );
      expect(db.tables.challenge_logs).toHaveLength(0);
    });

    it('refuses a former member even though the participant row is still active', async () => {
      db.tables.fitcircle_members.find((m) => m.user_id === ANA)!.status = 'left';
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE),
        'FORBIDDEN',
        403
      );
    });

    it('refuses a member who has not joined the challenge', async () => {
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, MEMBER_NOT_JOINED, { amount: 5 }, CIRCLE),
        'NOT_A_PARTICIPANT',
        403
      );
    });

    it('refuses a participant who withdrew', async () => {
      participantRow(P_ANA).status = 'withdrawn';
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE),
        'NOT_A_PARTICIPANT',
        403
      );
    });

    it('answers not-found for a challenge of another circle or one that does not exist', async () => {
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, OUTSIDER, { amount: 5 }, OTHER_CIRCLE),
        'NOT_FOUND',
        404
      );
      await expectChallengeError(
        ChallengeService.logActivity('99999999-9999-4999-8999-999999999999', ANA, { amount: 5 }, CIRCLE),
        'NOT_FOUND',
        404
      );
    });

    it('matches the circle id whatever its letter case (iOS sends uppercase uuids)', async () => {
      const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE.toUpperCase());
      expect(result.log.amount).toBe(5);
    });
  });

  describe('challenge state', () => {
    it('refuses a challenge that has not started', async () => {
      Object.assign(challengeRow(), { status: 'scheduled', starts_at: '2026-09-29T10:00:00.000Z' });
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE),
        'CHALLENGE_NOT_STARTED',
        400
      );
    });

    it('accepts a started challenge the daily cron has not activated yet, and activates it', async () => {
      Object.assign(challengeRow(), { status: 'scheduled', starts_at: '2026-09-28T09:00:00.000Z' });
      const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE);
      expect(result.log.amount).toBe(5);
      expect(challengeRow().status).toBe('active');
    });

    it('refuses a completed, an expired and a cancelled challenge', async () => {
      challengeRow().status = 'completed';
      await expectChallengeError(ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE), 'CHALLENGE_ENDED', 400);

      Object.assign(challengeRow(), { status: 'active', ends_at: '2026-09-28T11:59:59.000Z' });
      await expectChallengeError(ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE), 'CHALLENGE_ENDED', 400);

      Object.assign(challengeRow(), { status: 'cancelled', ends_at: '2026-10-08T10:00:00.000Z' });
      await expectChallengeError(ChallengeService.logActivity(CHALLENGE, ANA, { amount: 5 }, CIRCLE), 'CHALLENGE_NOT_ACTIVE', 400);

      expect(db.tables.challenge_logs).toHaveLength(0);
    });
  });

  describe('abuse limits', () => {
    it('refuses the same amount and note within 60 seconds, with the code both apps look for', async () => {
      await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20, note: 'set' }, CIRCLE);
      vi.setSystemTime(new Date(NOW.getTime() + 30_000));

      const error = await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20, note: ' set ' }, CIRCLE),
        'DUPLICATE_DETECTED',
        409
      );
      expect(error.message).toMatch(/duplicate/i);
      expect(db.tables.challenge_logs).toHaveLength(1);
      expect(participantRow(P_ANA).cumulative_total).toBe(20);
    });

    it('treats a missing note and a blank note as the same note', async () => {
      await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20 }, CIRCLE);
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20, note: '   ' }, CIRCLE),
        'DUPLICATE_DETECTED',
        409
      );
    });

    it('accepts the same amount with another note, and the same log after the window', async () => {
      await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20, note: 'set 1' }, CIRCLE);
      await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20, note: 'set 2' }, CIRCLE);
      vi.setSystemTime(new Date(NOW.getTime() + 61_000));
      await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20, note: 'set 1' }, CIRCLE);

      expect(db.tables.challenge_logs).toHaveLength(3);
      expect(participantRow(P_ANA).cumulative_total).toBe(60);
    });

    it('does not mistake another participant’s log for a duplicate', async () => {
      await ChallengeService.logActivity(CHALLENGE, BEN, { amount: 20 }, CIRCLE);
      const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 20 }, CIRCLE);
      expect(result.log.user_id).toBe(ANA);
    });

    it('refuses the 21st log of the day', async () => {
      for (let i = 0; i < 20; i++) {
        seedLog(P_ANA, ANA, i + 1, new Date(Date.UTC(2026, 8, 28, 1, i, 0)).toISOString());
      }
      await expectChallengeError(
        ChallengeService.logActivity(CHALLENGE, ANA, { amount: 500 }, CIRCLE),
        'DAILY_LIMIT_REACHED',
        400
      );
      expect(db.tables.challenge_logs).toHaveLength(20);
    });

    it('counts only today toward the daily limit', async () => {
      for (let i = 0; i < 20; i++) {
        seedLog(P_ANA, ANA, i + 1, new Date(Date.UTC(2026, 8, 27, 1, i, 0)).toISOString());
      }
      const result = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 3 }, CIRCLE);
      expect(result.updated_participant.today_total).toBe(3);
    });
  });
});

describe('ChallengeService.deleteLog', () => {
  it('removes the log and re-derives totals, percentage, streak, count and ranks', async () => {
    seedLog(P_BEN, BEN, 100, '2026-09-27T18:00:00.000Z');
    Object.assign(participantRow(P_BEN), { cumulative_total: 100, goal_completion_pct: 20, rank: 2 });
    seedLog(P_ANA, ANA, 60, '2026-09-27T18:00:00.000Z');
    await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 50, note: 'oops' }, CIRCLE);
    vi.setSystemTime(new Date('2026-09-28T13:00:00.000Z'));
    const keep = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 15 }, CIRCLE);
    expect(participantRow(P_ANA)).toMatchObject({ cumulative_total: 125, rank: 1, milestones_achieved: { milestone_25: true } });

    const mistake = db.tables.challenge_logs.find((l) => l.note === 'oops')!;
    await ChallengeService.deleteLog(mistake.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE });

    expect(db.tables.challenge_logs.map((l) => l.id)).not.toContain(mistake.id);
    expect(participantRow(P_ANA)).toMatchObject({
      cumulative_total: 75,
      today_total: 15,
      log_count: 2,
      goal_completion_pct: 15,
      current_streak: 2,
      last_logged_at: keep.log.logged_at,
      milestones_achieved: {},
      rank: 2,
    });
    expect(participantRow(P_BEN).rank).toBe(1);
  });

  it('resets the streak and last_logged_at when the only log is deleted', async () => {
    const { log } = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 50 }, CIRCLE);
    expect(participantRow(P_ANA).current_streak).toBe(1);

    await ChallengeService.deleteLog(log.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE });

    expect(participantRow(P_ANA)).toMatchObject({
      cumulative_total: 0,
      today_total: 0,
      log_count: 0,
      goal_completion_pct: 0,
      current_streak: 0,
      longest_streak: 0,
      last_logged_at: null,
    });
  });

  it('lets a milestone be earned again after the log that reached it was deleted', async () => {
    const first = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 130 }, CIRCLE);
    expect(first.milestone_reached).toBe('25%');
    await ChallengeService.deleteLog(first.log.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE });

    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    const second = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 130 }, CIRCLE);
    expect(second.milestone_reached).toBe('25%');
  });

  it('refuses to delete another user’s log and leaves it in place', async () => {
    const { log } = await ChallengeService.logActivity(CHALLENGE, BEN, { amount: 50 }, CIRCLE);

    await expectChallengeError(
      ChallengeService.deleteLog(log.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE }),
      'FORBIDDEN',
      403
    );
    expect(db.tables.challenge_logs).toHaveLength(1);
    expect(participantRow(P_BEN).cumulative_total).toBe(50);
  });

  it('refuses a log from an earlier day', async () => {
    const old = seedLog(P_ANA, ANA, 60, '2026-09-27T18:00:00.000Z');
    await expectChallengeError(
      ChallengeService.deleteLog(old.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE }),
      'LOG_LOCKED',
      400
    );
    expect(db.tables.challenge_logs).toHaveLength(1);
  });

  it('answers not-found for an unknown log and for a log addressed through the wrong challenge or circle', async () => {
    const { log } = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 50 }, CIRCLE);

    await expectChallengeError(ChallengeService.deleteLog('nope', ANA, { circleId: CIRCLE, challengeId: CHALLENGE }), 'NOT_FOUND', 404);
    await expectChallengeError(
      ChallengeService.deleteLog(log.id, ANA, { circleId: CIRCLE, challengeId: '99999999-9999-4999-8999-999999999999' }),
      'NOT_FOUND',
      404
    );
    await expectChallengeError(
      ChallengeService.deleteLog(log.id, ANA, { circleId: OTHER_CIRCLE, challengeId: CHALLENGE }),
      'NOT_FOUND',
      404
    );
    expect(db.tables.challenge_logs).toHaveLength(1);
  });

  it('refuses once the challenge is completed (results are locked)', async () => {
    const { log } = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 50 }, CIRCLE);
    challengeRow().status = 'completed';
    await expectChallengeError(
      ChallengeService.deleteLog(log.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE }),
      'CHALLENGE_ENDED',
      400
    );
  });

  it('refuses a user who is no longer a member of the circle', async () => {
    const { log } = await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 50 }, CIRCLE);
    db.tables.fitcircle_members.find((m) => m.user_id === ANA)!.status = 'left';
    await expectChallengeError(
      ChallengeService.deleteLog(log.id, ANA, { circleId: CIRCLE, challengeId: CHALLENGE }),
      'FORBIDDEN',
      403
    );
  });
});

describe('ChallengeService.getMyLogs', () => {
  beforeEach(() => {
    seedLog(P_ANA, ANA, 10, '2026-09-27T08:00:00.000Z');
    seedLog(P_ANA, ANA, 20, '2026-09-28T08:00:00.000Z');
    seedLog(P_ANA, ANA, 30, '2026-09-28T09:00:00.000Z');
    seedLog(P_BEN, BEN, 99, '2026-09-28T10:00:00.000Z');
  });

  it('returns only the caller’s logs, newest first', async () => {
    const logs = await ChallengeService.getMyLogs(CHALLENGE, ANA, 50, 0, CIRCLE);
    expect(logs.map((l) => l.amount)).toEqual([30, 20, 10]);
    expect(logs.every((l) => l.user_id === ANA)).toBe(true);
  });

  it('pages with limit and offset', async () => {
    expect((await ChallengeService.getMyLogs(CHALLENGE, ANA, 2, 0, CIRCLE)).map((l) => l.amount)).toEqual([30, 20]);
    expect((await ChallengeService.getMyLogs(CHALLENGE, ANA, 2, 2, CIRCLE)).map((l) => l.amount)).toEqual([10]);
  });

  it('always returns amount as a number', async () => {
    db.tables.challenge_logs[0].amount = '10.00';
    const logs = await ChallengeService.getMyLogs(CHALLENGE, ANA, 50, 0, CIRCLE);
    expect(logs.map((l) => l.amount)).toEqual([30, 20, 10]);
  });

  it('is an empty list for a member who has not joined (both apps load it for every challenge they open)', async () => {
    expect(await ChallengeService.getMyLogs(CHALLENGE, MEMBER_NOT_JOINED, 50, 0, CIRCLE)).toEqual([]);
  });

  it('refuses a user outside the circle and hides a challenge of another circle', async () => {
    await expectChallengeError(ChallengeService.getMyLogs(CHALLENGE, OUTSIDER, 50, 0, CIRCLE), 'FORBIDDEN', 403);
    await expectChallengeError(ChallengeService.getMyLogs(CHALLENGE, OUTSIDER, 50, 0, OTHER_CIRCLE), 'NOT_FOUND', 404);
  });
});

describe('challenge responses for clients with a strict category enum', () => {
  it('presents an unknown stored category as custom and keeps the true value in category_raw', async () => {
    db.tables.challenges.push({
      ...challengeRow(),
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Mixed bag',
      category: 'mixed',
    });

    const list = await ChallengeService.getCircleChallenges(CIRCLE, ANA);
    const byName = Object.fromEntries(list.active.map((c) => [c.name, c]));

    expect(byName['Mixed bag'].category).toBe('custom');
    expect(byName['Mixed bag'].category_raw).toBe('mixed');
    expect(byName['500 Pushups'].category).toBe('strength');
    expect(byName['500 Pushups'].category_raw).toBe('strength');

    // Nothing was rewritten in the table.
    expect(db.tables.challenges.map((c) => c.category).sort()).toEqual(['mixed', 'strength']);
    expect(db.writes.filter((w) => w.table === 'challenges')).toEqual([]);

    const detail = await ChallengeService.getChallenge('44444444-4444-4444-8444-444444444444', ANA);
    expect(detail.category).toBe('custom');
  });

  it('only ever returns the five values the iOS enum decodes', async () => {
    for (const [index, category] of ['mixed', 'weight_loss', '', 'Cardio'].entries()) {
      db.tables.challenges.push({ ...challengeRow(), id: `55555555-5555-4555-8555-55555555555${index}`, category });
    }
    const list = await ChallengeService.getCircleChallenges(CIRCLE, ANA);
    const known = ['strength', 'cardio', 'flexibility', 'wellness', 'custom'];
    for (const challenge of [...list.active, ...list.scheduled, ...list.completed]) {
      expect(known).toContain(challenge.category);
    }
  });

  it('keeps every field the list response had before (additive change only)', async () => {
    const list = await ChallengeService.getCircleChallenges(CIRCLE, ANA);
    expect(Object.keys(list).sort()).toEqual(['active', 'completed', 'scheduled']);
    const [challenge] = list.active;
    for (const key of [
      'id', 'fitcircle_id', 'creator_id', 'template_id', 'name', 'description', 'category', 'goal_amount', 'unit',
      'logging_prompt', 'is_open', 'status', 'starts_at', 'ends_at', 'participant_count', 'winner_user_id',
      'created_at', 'updated_at', 'creator_name', 'my_participation', 'duration_days', 'days_remaining', 'template',
    ]) {
      expect(challenge).toHaveProperty(key);
    }
    expect(challenge.creator_name).toBe('Ana');
    expect(challenge.my_participation).toMatchObject({ id: P_ANA, status: 'active' });
  });
});

describe('my_participation in challenge responses', () => {
  it('shows today_total while it is from today and 0 once the day has passed, like the leaderboard', async () => {
    await ChallengeService.logActivity(CHALLENGE, ANA, { amount: 40 }, CIRCLE);

    const sameDay = await ChallengeService.getChallenge(CHALLENGE, ANA);
    expect(sameDay.my_participation).toMatchObject({ today_total: 40, cumulative_total: 40, goal_completion_pct: 8 });

    vi.setSystemTime(new Date('2026-09-29T00:00:01.000Z'));
    const nextDay = await ChallengeService.getChallenge(CHALLENGE, ANA);
    expect(nextDay.my_participation).toMatchObject({ today_total: 0, cumulative_total: 40, goal_completion_pct: 8 });
    expect((await ChallengeService.getLeaderboard(CHALLENGE, ANA))[0]).toMatchObject({
      today_total: 0,
      cumulative_total: 40,
    });

    // Presentation only: the stored row is untouched.
    expect(participantRow(P_ANA).today_total).toBe(40);
  });

  it('is null for a member who has not joined', async () => {
    const challenge = await ChallengeService.getChallenge(CHALLENGE, MEMBER_NOT_JOINED);
    expect(challenge.my_participation).toBeNull();
  });
});

describe('ChallengeService.updateChallenge', () => {
  it('writes the editable columns and ignores every other key of the request body', async () => {
    Object.assign(challengeRow(), { status: 'scheduled', starts_at: '2026-09-30T10:00:00.000Z' });

    const updated = await ChallengeService.updateChallenge(CHALLENGE, ANA, {
      name: 'Renamed',
      goal_amount: 600,
      status: 'completed',
      creator_id: BEN,
      winner_user_id: ANA,
      fitcircle_id: OTHER_CIRCLE,
    } as never);

    expect(updated.name).toBe('Renamed');
    expect(challengeRow()).toMatchObject({
      name: 'Renamed',
      goal_amount: 600,
      status: 'scheduled',
      creator_id: ANA,
      winner_user_id: null,
      fitcircle_id: CIRCLE,
    });
  });

  it('still refuses anyone but the creator, and a challenge that has started', async () => {
    await expect(ChallengeService.updateChallenge(CHALLENGE, BEN, { name: 'Hijack' })).rejects.toThrow(
      'Only the creator can update this challenge'
    );
    await expect(ChallengeService.updateChallenge(CHALLENGE, ANA, { name: 'Too late' })).rejects.toThrow(
      'Can only update challenges that have not started'
    );
  });
});

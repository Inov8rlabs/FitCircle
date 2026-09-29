import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from './circle-fake-db';

vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => getCircleDb().client(),
}));
vi.mock('../chat-activity-hooks', () => ({
  ChatActivityHooks: { onMemberJoined: vi.fn().mockResolvedValue(undefined) },
}));
const createDailyGoalsForChallenge = vi.fn();
vi.mock('../daily-goals', () => ({
  DailyGoalService: {
    createDailyGoalsForChallenge: (...args: unknown[]) => createDailyGoalsForChallenge(...args),
  },
}));

import { CircleJoinError, CircleService, inviteCodeCandidates } from '../circle-service';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const OTHER_CIRCLE = '22222222-2222-4222-8222-222222222222';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OUTSIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function seed(): CircleFakeDb {
  const db = new CircleFakeDb();
  db.tables.fitcircles.push(
    {
      id: CIRCLE,
      creator_id: CREATOR,
      name: 'Morning Crew',
      invite_code: 'FITABC234',
      participant_count: 3,
      visibility: 'private',
      status: 'upcoming',
      start_date: inDays(3),
      end_date: inDays(33),
      allow_late_join: true,
      late_join_deadline: 3,
    },
    {
      id: OTHER_CIRCLE,
      creator_id: MEMBER,
      name: 'Other',
      invite_code: 'FIT-XYZ789',
      participant_count: 1,
      visibility: 'private',
      status: 'upcoming',
      start_date: inDays(3),
      end_date: inDays(33),
      allow_late_join: true,
      late_join_deadline: 3,
    }
  );
  db.tables.fitcircle_members.push(
    { id: 'm-creator', fitcircle_id: CIRCLE, user_id: CREATOR, status: 'active' },
    { id: 'm-1', fitcircle_id: CIRCLE, user_id: MEMBER, status: 'active' },
    { id: 'm-2', fitcircle_id: CIRCLE, user_id: MEMBER_2, status: 'active' },
    { id: 'm-other', fitcircle_id: OTHER_CIRCLE, user_id: MEMBER, status: 'active' }
  );
  setCircleDb(db);
  return db;
}

const membersOf = (db: CircleFakeDb, circleId: string) =>
  db.tables.fitcircle_members.filter((m) => m.fitcircle_id === circleId).map((m) => m.user_id);

describe('CircleService.removeParticipant — permission matrix', () => {
  let db: CircleFakeDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = seed();
  });

  it('lets the creator remove a member and recounts the circle', async () => {
    const result = await CircleService.removeParticipant(CREATOR, CIRCLE, MEMBER, { requireMembership: true });

    expect(result).toEqual({ ok: true, circleId: CIRCLE, userId: MEMBER });
    expect(membersOf(db, CIRCLE)).toEqual([CREATOR, MEMBER_2]);
    expect(db.tables.fitcircles[0].participant_count).toBe(2);
    // The same user's membership of ANOTHER circle is untouched.
    expect(membersOf(db, OTHER_CIRCLE)).toEqual([MEMBER]);
  });

  it('accepts the UPPERCASE uuids iOS puts in the path', async () => {
    const result = await CircleService.removeParticipant(
      CREATOR,
      CIRCLE.toUpperCase(),
      MEMBER.toUpperCase(),
      { requireMembership: true }
    );

    expect(result.ok).toBe(true);
    expect(membersOf(db, CIRCLE)).toEqual([CREATOR, MEMBER_2]);
  });

  it('refuses a member who is not the creator', async () => {
    const result = await CircleService.removeParticipant(MEMBER, CIRCLE, MEMBER_2, { requireMembership: true });

    expect(result).toEqual({ ok: false, reason: 'NOT_CREATOR' });
    expect(membersOf(db, CIRCLE)).toHaveLength(3);
  });

  it('refuses a member removing THEMSELVES (not the creator)', async () => {
    const result = await CircleService.removeParticipant(MEMBER, CIRCLE, MEMBER, { requireMembership: true });

    expect(result).toEqual({ ok: false, reason: 'NOT_CREATOR' });
    expect(membersOf(db, CIRCLE)).toHaveLength(3);
  });

  it('refuses someone who is not in the circle at all', async () => {
    const result = await CircleService.removeParticipant(OUTSIDER, CIRCLE, MEMBER, { requireMembership: true });

    expect(result).toEqual({ ok: false, reason: 'NOT_CREATOR' });
    expect(membersOf(db, CIRCLE)).toHaveLength(3);
  });

  it('never removes the creator, even when the creator asks (also in uppercase)', async () => {
    for (const target of [CREATOR, CREATOR.toUpperCase()]) {
      const result = await CircleService.removeParticipant(CREATOR, CIRCLE, target, { requireMembership: true });
      expect(result).toEqual({ ok: false, reason: 'CANNOT_REMOVE_CREATOR' });
    }
    expect(membersOf(db, CIRCLE)).toHaveLength(3);
  });

  it('being the creator of ANOTHER circle gives no rights here', async () => {
    // MEMBER created OTHER_CIRCLE but is only a member of CIRCLE.
    const result = await CircleService.removeParticipant(MEMBER, CIRCLE, MEMBER_2, { requireMembership: true });
    expect(result).toEqual({ ok: false, reason: 'NOT_CREATOR' });
  });

  it('reports a target who is not a member (mobile)', async () => {
    const result = await CircleService.removeParticipant(CREATOR, CIRCLE, OUTSIDER, { requireMembership: true });

    expect(result).toEqual({ ok: false, reason: 'NOT_A_MEMBER' });
    expect(db.log.filter((entry) => entry.op === 'delete')).toHaveLength(0);
  });

  it('keeps the web behaviour: a non-member target is a successful no-op', async () => {
    const result = await CircleService.removeParticipant(CREATOR, CIRCLE, OUTSIDER);

    expect(result).toEqual({ ok: true, circleId: CIRCLE, userId: OUTSIDER });
    expect(membersOf(db, CIRCLE)).toHaveLength(3);
    expect(db.tables.fitcircles[0].participant_count).toBe(3);
  });

  it('reports an unknown circle, and a circle id that is not a uuid', async () => {
    const missing = '99999999-9999-4999-8999-999999999999';
    expect(await CircleService.removeParticipant(CREATOR, missing, MEMBER)).toEqual({
      ok: false,
      reason: 'CIRCLE_NOT_FOUND',
    });
    expect(await CircleService.removeParticipant(CREATOR, 'not-a-uuid', MEMBER)).toEqual({
      ok: false,
      reason: 'CIRCLE_NOT_FOUND',
    });
  });

  it('reads the circle through the client the web route supplies', async () => {
    const single = vi.fn().mockResolvedValue({ data: { creator_id: CREATOR }, error: null });
    const circleClient = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) })) };

    const result = await CircleService.removeParticipant(CREATOR, CIRCLE, MEMBER, { circleClient });

    expect(circleClient.from).toHaveBeenCalledWith('fitcircles');
    expect(result.ok).toBe(true);
    expect(membersOf(db, CIRCLE)).toEqual([CREATOR, MEMBER_2]);
  });

  it('a read error through the supplied client means "not found"; through the default client it is thrown', async () => {
    const failing = { code: '42501', message: 'permission denied' };
    const circleClient = {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: failing }) }) }) }),
    };

    expect(await CircleService.removeParticipant(CREATOR, CIRCLE, MEMBER, { circleClient })).toEqual({
      ok: false,
      reason: 'CIRCLE_NOT_FOUND',
    });
    expect(membersOf(db, CIRCLE)).toHaveLength(3);

    db.client = () => ({ from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: failing }) }) }) }) }) as any;
    await expect(CircleService.removeParticipant(CREATOR, CIRCLE, MEMBER)).rejects.toEqual(failing);
  });
});

describe('inviteCodeCandidates', () => {
  it('upper-cases, strips spaces and offers both hyphen forms', () => {
    expect(inviteCodeCandidates(' fit-abc234 ')).toEqual(['FIT-ABC234', 'FITABC234']);
    expect(inviteCodeCandidates('fitabc234')).toEqual(['FITABC234', 'FIT-ABC234']);
  });

  it('passes an unusual code through as typed and rejects non-strings', () => {
    expect(inviteCodeCandidates('hello')).toEqual(['HELLO']);
    expect(inviteCodeCandidates('   ')).toEqual([]);
    expect(inviteCodeCandidates(null)).toEqual([]);
  });
});

describe('CircleService.joinByInviteCode', () => {
  let db: CircleFakeDb;
  beforeEach(() => {
    vi.clearAllMocks();
    createDailyGoalsForChallenge.mockResolvedValue({ success: true, goals: [], error: null });
    db = seed();
  });

  it('finds the circle from the code when the path id names no circle (iOS sends a random uuid)', async () => {
    const randomPathId = 'EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE';

    const circle = await CircleService.joinByInviteCode(OUTSIDER, 'fitabc234', { pathCircleId: randomPathId });

    expect(circle.id).toBe(CIRCLE);
    expect(membersOf(db, CIRCLE)).toContain(OUTSIDER);
    const joined = db.tables.fitcircle_members.find((m) => m.user_id === OUTSIDER);
    expect(joined).toMatchObject({ fitcircle_id: CIRCLE, status: 'active', invited_by: CREATOR });
    expect(db.tables.fitcircles[0].participant_count).toBe(4);
    expect(createDailyGoalsForChallenge).toHaveBeenCalledWith(OUTSIDER, CIRCLE, expect.anything());
  });

  it('returns the fields the iOS FitCircle model requires', async () => {
    const circle = (await CircleService.joinByInviteCode(OUTSIDER, 'FITABC234')) as unknown as Record<string, unknown>;

    for (const key of ['id', 'creator_id', 'name', 'status', 'start_date', 'end_date', 'participant_count']) {
      expect(circle[key], key).toBeDefined();
    }
    expect(circle.participant_count).toBe(4); // recounted from the roster
  });

  it('matches a code stored with a hyphen when typed without one', async () => {
    const circle = await CircleService.joinByInviteCode(OUTSIDER, 'fitxyz789');
    expect(circle.id).toBe(OTHER_CIRCLE);
  });

  it('accepts a path id that IS the circle of the code, in any case', async () => {
    const circle = await CircleService.joinByInviteCode(OUTSIDER, 'FITABC234', {
      pathCircleId: CIRCLE.toUpperCase(),
    });
    expect(circle.id).toBe(CIRCLE);
  });

  it('refuses a code that belongs to a different circle than the one in the path', async () => {
    await expect(
      CircleService.joinByInviteCode(OUTSIDER, 'FITABC234', { pathCircleId: OTHER_CIRCLE })
    ).rejects.toThrow(new CircleJoinError('Invalid invite code for this circle'));
    expect(membersOf(db, CIRCLE)).not.toContain(OUTSIDER);
    expect(membersOf(db, OTHER_CIRCLE)).not.toContain(OUTSIDER);
  });

  it('refuses an unknown code', async () => {
    await expect(CircleService.joinByInviteCode(OUTSIDER, 'FITNOPE99')).rejects.toBeInstanceOf(CircleJoinError);
    expect(db.log.filter((entry) => entry.op === 'insert')).toHaveLength(0);
  });

  it('refuses someone who is already a member', async () => {
    await expect(CircleService.joinByInviteCode(MEMBER, 'FITABC234')).rejects.toThrow(
      'You are already a member of this circle'
    );
    expect(membersOf(db, CIRCLE)).toHaveLength(3);
  });

  it('refuses a circle that has ended', async () => {
    Object.assign(db.tables.fitcircles[0], { start_date: inDays(-40), end_date: inDays(-10) });

    await expect(CircleService.joinByInviteCode(OUTSIDER, 'FITABC234')).rejects.toThrow(
      'This circle has already ended'
    );
    expect(membersOf(db, CIRCLE)).not.toContain(OUTSIDER);
  });

  it('still joins when daily-goal creation fails', async () => {
    createDailyGoalsForChallenge.mockRejectedValue(new Error('boom'));

    const circle = await CircleService.joinByInviteCode(OUTSIDER, 'FITABC234');

    expect(circle.id).toBe(CIRCLE);
    expect(membersOf(db, CIRCLE)).toContain(OUTSIDER);
  });
});

describe('CircleService.createCircle — visibility', () => {
  let db: CircleFakeDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = new CircleFakeDb();
    setCircleDb(db);
  });

  const input = { name: 'Steps', start_date: '2026-10-10', end_date: '2026-11-09' };

  it('stores the visibility the caller chose', async () => {
    await CircleService.createCircle(CREATOR, { ...input, visibility: 'private' });
    expect(db.tables.fitcircles[0].visibility).toBe('private');
  });

  it('writes no visibility when none was sent, so the column default still applies', async () => {
    await CircleService.createCircle(CREATOR, input);

    const inserted = db.log.find((entry) => entry.table === 'fitcircles' && entry.op === 'insert');
    expect(inserted?.payload).toBeDefined();
    expect(Object.keys(inserted!.payload!)).not.toContain('visibility');
  });
});

describe('CircleFakeDb', () => {
  it('answers a column that does not exist the way PostgREST does', async () => {
    const db = seed();

    // The two mistakes that shipped: fitcircles.created_by and fitcircle_members.left_at.
    const circle = await db.client().from('fitcircles').select('id, created_by, start_date').eq('id', CIRCLE).single();
    expect(circle.data).toBeNull();
    expect(circle.error).toMatchObject({ code: '42703' });

    const member = await db.client().from('fitcircle_members').select('id, status, left_at').eq('user_id', MEMBER).single();
    expect(member.error).toMatchObject({ code: '42703' });

    const ok = await db.client().from('fitcircles').select('id, creator_id, start_date').eq('id', CIRCLE).single();
    expect(ok.error).toBeNull();
    expect(ok.data?.creator_id).toBe(CREATOR);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

const getUser = vi.fn();

// The cookie client identifies the caller AND reads the circle, as it always did.
const cookieClientFrom = vi.fn((table: string) => getCircleDb().client().from(table));
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: () => getUser() },
    from: (table: string) => cookieClientFrom(table),
  }),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { POST } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OUTSIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const remove = (circleId: string, userId: string) =>
  POST(
    new Request(`http://localhost/api/fitcircles/${circleId}/participants/${userId}/remove`, {
      method: 'POST',
    }) as any,
    { params: Promise.resolve({ id: circleId, userId }) }
  );

const signedInAs = (id: string | null) =>
  getUser.mockResolvedValue(
    id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'no session' } }
  );

let db: CircleFakeDb;
const roster = () => db.tables.fitcircle_members.map((m) => m.user_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = new CircleFakeDb();
  db.tables.fitcircles.push({ id: CIRCLE, creator_id: CREATOR, name: 'Morning Crew', participant_count: 2 });
  db.tables.fitcircle_members.push(
    { id: 'm0', fitcircle_id: CIRCLE, user_id: CREATOR, status: 'active' },
    { id: 'm1', fitcircle_id: CIRCLE, user_id: MEMBER, status: 'active' }
  );
  setCircleDb(db);
});

/** The web route now shares CircleService.removeParticipant; its answers must not move. */
describe('POST /api/fitcircles/[id]/participants/[userId]/remove', () => {
  it('creator removes a member: { success, message }', async () => {
    signedInAs(CREATOR);
    const res = await remove(CIRCLE, MEMBER);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Participant removed successfully' });
    expect(roster()).toEqual([CREATOR]);
    expect(cookieClientFrom).toHaveBeenCalledWith('fitcircles');
  });

  it('a target who is not in the circle is still a successful no-op', async () => {
    signedInAs(CREATOR);
    const res = await remove(CIRCLE, OUTSIDER);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Participant removed successfully' });
    expect(roster()).toEqual([CREATOR, MEMBER]);
  });

  it('403 for anyone but the creator', async () => {
    signedInAs(MEMBER);
    const res = await remove(CIRCLE, CREATOR);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Only the creator can remove participants' });
    expect(roster()).toEqual([CREATOR, MEMBER]);
  });

  it('400 when the creator targets the creator', async () => {
    signedInAs(CREATOR);
    const res = await remove(CIRCLE, CREATOR);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Cannot remove the creator' });
    expect(roster()).toEqual([CREATOR, MEMBER]);
  });

  it('404 for an unknown circle', async () => {
    signedInAs(CREATOR);
    const res = await remove('99999999-9999-4999-8999-999999999999', MEMBER);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Challenge not found' });
  });

  it('401 without a session', async () => {
    signedInAs(null);
    const res = await remove(CIRCLE, MEMBER);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(roster()).toEqual([CREATOR, MEMBER]);
  });
});

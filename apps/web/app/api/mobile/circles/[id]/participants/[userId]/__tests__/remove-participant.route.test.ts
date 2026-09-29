import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

import { iosEnvelopeProblems } from '../../../../__tests__/ios-models';

const requireMobileAuth = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_request: unknown, response: unknown) => response,
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { DELETE } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OUTSIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const remove = (circleId: string, userId: string) =>
  DELETE(
    new Request(`http://localhost/api/mobile/circles/${circleId}/participants/${userId}`, {
      method: 'DELETE',
    }) as any,
    { params: Promise.resolve({ id: circleId, userId }) }
  );

let db: CircleFakeDb;
const roster = () => db.tables.fitcircle_members.map((m) => m.user_id);

beforeEach(() => {
  vi.clearAllMocks();
  db = new CircleFakeDb();
  db.tables.fitcircles.push({ id: CIRCLE, creator_id: CREATOR, name: 'Morning Crew', participant_count: 3 });
  db.tables.fitcircle_members.push(
    { id: 'm0', fitcircle_id: CIRCLE, user_id: CREATOR, status: 'active' },
    { id: 'm1', fitcircle_id: CIRCLE, user_id: MEMBER, status: 'active' },
    { id: 'm2', fitcircle_id: CIRCLE, user_id: MEMBER_2, status: 'active' }
  );
  setCircleDb(db);
});

describe('DELETE /api/mobile/circles/[id]/participants/[userId]', () => {
  it('creator removes a member: 200 and an envelope iOS decodes (APIResponse<EmptyResponse>)', async () => {
    requireMobileAuth.mockResolvedValue({ id: CREATOR });
    // iOS builds the path from UUID.uuidString, which is uppercase.
    const res = await remove(CIRCLE.toUpperCase(), MEMBER.toUpperCase());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { message: 'Participant removed successfully', removed_user_id: MEMBER, circle_id: CIRCLE },
      error: null,
      meta: null,
    });
    expect(iosEnvelopeProblems(body)).toEqual([]);
    expect(roster()).toEqual([CREATOR, MEMBER_2]);
    expect(db.tables.fitcircles[0].participant_count).toBe(2);
  });

  const matrix: Array<{
    name: string;
    requester: string;
    target: string;
    status: number;
    code: string;
  }> = [
    { name: 'member removes another member', requester: MEMBER, target: MEMBER_2, status: 403, code: 'FORBIDDEN' },
    { name: 'member removes themselves', requester: MEMBER, target: MEMBER, status: 403, code: 'FORBIDDEN' },
    { name: 'member removes the creator', requester: MEMBER, target: CREATOR, status: 403, code: 'FORBIDDEN' },
    { name: 'outsider removes a member', requester: OUTSIDER, target: MEMBER, status: 403, code: 'FORBIDDEN' },
    { name: 'creator removes themselves', requester: CREATOR, target: CREATOR, status: 400, code: 'VALIDATION_ERROR' },
    { name: 'creator removes a non-member', requester: CREATOR, target: OUTSIDER, status: 404, code: 'NOT_FOUND' },
  ];

  for (const row of matrix) {
    it(`${row.name}: ${row.status} ${row.code}, nobody removed`, async () => {
      requireMobileAuth.mockResolvedValue({ id: row.requester });
      const res = await remove(CIRCLE, row.target);
      const body = await res.json();

      expect(res.status).toBe(row.status);
      expect(body.success).toBe(false);
      expect(body.data).toBeNull();
      expect(body.error.code).toBe(row.code);
      expect(typeof body.error.message).toBe('string');
      expect(iosEnvelopeProblems(body)).toEqual([]);
      expect(roster()).toEqual([CREATOR, MEMBER, MEMBER_2]);
      expect(db.tables.fitcircles[0].participant_count).toBe(3);
    });
  }

  it('unknown circle: 404 NOT_FOUND', async () => {
    requireMobileAuth.mockResolvedValue({ id: CREATOR });
    const res = await remove('99999999-9999-4999-8999-999999999999', MEMBER);

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(roster()).toHaveLength(3);
  });

  it('ids that are not uuids: 400 VALIDATION_ERROR before any query', async () => {
    requireMobileAuth.mockResolvedValue({ id: CREATOR });

    expect((await remove('nope', MEMBER)).status).toBe(400);
    expect((await remove(CIRCLE, 'nope')).status).toBe(400);
    expect(db.log).toHaveLength(0);
  });

  it('unauthenticated: 401, nobody removed', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await remove(CIRCLE, MEMBER);

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    expect(roster()).toHaveLength(3);
  });

  it('never takes the acting user from the request: a forged body or header changes nothing', async () => {
    requireMobileAuth.mockResolvedValue({ id: MEMBER });
    const res = await DELETE(
      new Request(`http://localhost/api/mobile/circles/${CIRCLE}/participants/${MEMBER_2}?user_id=${CREATOR}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': CREATOR },
        body: JSON.stringify({ user_id: CREATOR, requester_id: CREATOR }),
      }) as any,
      { params: Promise.resolve({ id: CIRCLE, userId: MEMBER_2 }) }
    );

    expect(res.status).toBe(403);
    expect(roster()).toHaveLength(3);
  });
});

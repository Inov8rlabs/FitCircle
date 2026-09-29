import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

import { iosEnvelopeProblems, iosFitCircleProblems } from '../../../__tests__/ios-models';

const requireMobileAuth = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
vi.mock('@/lib/services/chat-activity-hooks', () => ({
  ChatActivityHooks: { onMemberJoined: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/services/daily-goals', () => ({
  DailyGoalService: { createDailyGoalsForChallenge: vi.fn().mockResolvedValue({ success: true }) },
}));

import { POST } from '../route';

const PRIVATE_CIRCLE = '11111111-1111-4111-8111-111111111111';
const PUBLIC_CIRCLE = '22222222-2222-4222-8222-222222222222';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOINER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
/** iOS: `apiClient.joinFitCircle(UUID(), request)` — a fresh uuid, uppercase. */
const RANDOM_IOS_PATH_ID = 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F';

const inDays = (days: number) =>
  new Date(Math.floor((Date.now() + days * 86_400_000) / 1000) * 1000).toISOString().replace('.000Z', '+00:00');

const post = (pathId: string, body?: unknown) =>
  POST(
    new Request(`http://localhost/api/mobile/circles/${pathId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    }) as any,
    { params: Promise.resolve({ id: pathId }) }
  );

let db: CircleFakeDb;
const members = (circleId: string) =>
  db.tables.fitcircle_members.filter((m) => m.fitcircle_id === circleId).map((m) => m.user_id);

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: JOINER });
  db = new CircleFakeDb();
  const base = {
    creator_id: CREATOR,
    type: 'weight_loss',
    status: 'upcoming',
    start_date: inDays(3),
    end_date: inDays(33),
    participant_count: 1,
    allow_late_join: true,
    late_join_deadline: 3,
  };
  db.tables.fitcircles.push(
    { ...base, id: PRIVATE_CIRCLE, name: 'Morning Crew', visibility: 'private', invite_code: 'FITABC234' },
    { ...base, id: PUBLIC_CIRCLE, name: 'Open Steps', visibility: 'public', invite_code: 'FITPUB999' }
  );
  db.tables.fitcircle_members.push(
    { id: 'm1', fitcircle_id: PRIVATE_CIRCLE, user_id: CREATOR, status: 'active' },
    { id: 'm2', fitcircle_id: PUBLIC_CIRCLE, user_id: CREATOR, status: 'active' }
  );
  setCircleDb(db);
});

describe('POST /api/mobile/circles/[id]/join', () => {
  describe('invite code in the body (iOS join by code)', () => {
    it('joins the circle of the CODE when the path id is a random uuid', async () => {
      const res = await post(RANDOM_IOS_PATH_ID, { invite_code: 'FITABC234' });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(PRIVATE_CIRCLE);
      expect(members(PRIVATE_CIRCLE)).toEqual([CREATOR, JOINER]);
      expect(members(PUBLIC_CIRCLE)).toEqual([CREATOR]);
    });

    it('answers the shape iOS decodes: APIResponse<FitCircle>', async () => {
      const body = await (await post(RANDOM_IOS_PATH_ID, { invite_code: 'FITABC234' })).json();

      expect(iosEnvelopeProblems(body)).toEqual([]);
      expect(iosFitCircleProblems(body.data)).toEqual([]);
      expect(body.data.participant_count).toBe(2);
    });

    it('accepts the code as the user typed it (lowercase, spaces)', async () => {
      const res = await post(RANDOM_IOS_PATH_ID, { invite_code: ' fitabc234 ' });
      expect(res.status).toBe(201);
      expect(members(PRIVATE_CIRCLE)).toContain(JOINER);
    });

    it('accepts the camelCase key and a path id that is not a uuid at all', async () => {
      const res = await post('join-by-code', { inviteCode: 'FITABC234' });
      expect(res.status).toBe(201);
      expect((await res.json()).data.id).toBe(PRIVATE_CIRCLE);
    });

    it('accepts a path id that is the circle of the code', async () => {
      const res = await post(PRIVATE_CIRCLE.toUpperCase(), { invite_code: 'FITABC234' });
      expect(res.status).toBe(201);
    });

    it('400 INVALID_JOIN when the code belongs to another circle than the path names', async () => {
      const res = await post(PUBLIC_CIRCLE, { invite_code: 'FITABC234' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('INVALID_JOIN');
      expect(members(PRIVATE_CIRCLE)).toEqual([CREATOR]);
      expect(members(PUBLIC_CIRCLE)).toEqual([CREATOR]);
    });

    it('400 INVALID_JOIN for an unknown code', async () => {
      const res = await post(RANDOM_IOS_PATH_ID, { invite_code: 'FITNOPE99' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toEqual({ code: 'INVALID_JOIN', message: 'Invalid invite code' });
      expect(iosEnvelopeProblems(body)).toEqual([]);
    });

    it('400 INVALID_JOIN when already a member', async () => {
      requireMobileAuth.mockResolvedValue({ id: CREATOR });
      const res = await post(RANDOM_IOS_PATH_ID, { invite_code: 'FITABC234' });

      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toBe('You are already a member of this circle');
      expect(members(PRIVATE_CIRCLE)).toEqual([CREATOR]);
    });
  });

  describe('public join (no invite code) is unchanged', () => {
    it('joins a public circle with an empty JSON body (iOS JoinCircleRequest(inviteCode: nil))', async () => {
      const res = await post(PUBLIC_CIRCLE, {});
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.id).toBe(PUBLIC_CIRCLE);
      expect(iosFitCircleProblems(body.data)).toEqual([]);
      expect(members(PUBLIC_CIRCLE)).toEqual([CREATOR, JOINER]);
    });

    it('joins with no body at all (Android, web onboarding)', async () => {
      expect((await post(PUBLIC_CIRCLE)).status).toBe(201);
    });

    it('treats an explicit null code, an empty code and an unparseable body as "no code"', async () => {
      expect((await post(PUBLIC_CIRCLE, { invite_code: null, inviteCode: null })).status).toBe(201);

      requireMobileAuth.mockResolvedValue({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
      expect((await post(PUBLIC_CIRCLE, { invite_code: '' })).status).toBe(201);

      requireMobileAuth.mockResolvedValue({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
      expect((await post(PUBLIC_CIRCLE, 'not json')).status).toBe(201);
    });

    it('400 INVALID_JOIN for a private circle without a code', async () => {
      const res = await post(PRIVATE_CIRCLE, {});
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('INVALID_JOIN');
      expect(body.error.message).toBe('Circle is not public — invite code required');
      expect(members(PRIVATE_CIRCLE)).toEqual([CREATOR]);
    });

    it('404 NOT_FOUND for an unknown circle', async () => {
      const res = await post(RANDOM_IOS_PATH_ID, {});
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('NOT_FOUND');
    });

    it('400 VALIDATION_ERROR for a path id that is not a uuid, with a readable message', async () => {
      const res = await post('nope', {});
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.error.details)).toBe(true);
      expect(typeof body.error.message).toBe('string');
    });
  });

  it('401 when unauthenticated', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await post(PUBLIC_CIRCLE, {})).status).toBe(401);
  });
});

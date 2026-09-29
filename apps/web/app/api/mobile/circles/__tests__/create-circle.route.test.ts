import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

import { iosEnvelopeProblems, iosFitCircleProblems } from './ios-models';

const requireMobileAuth = vi.fn();
const checkCircleCreation = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
vi.mock('@/lib/services/usage-service', () => ({
  UsageService: { checkCircleCreation: (...args: unknown[]) => checkCircleCreation(...args) },
}));
vi.mock('@/lib/services/chat-activity-hooks', () => ({
  ChatActivityHooks: { onMemberJoined: vi.fn().mockResolvedValue(undefined) },
}));

import { POST } from '../route';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://localhost/api/mobile/circles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }) as any
  );

/** Android `CreateCircleRequest` (core/model/FitCircle.kt) — the original contract. */
const ANDROID_BODY = {
  name: 'Step Squad',
  type: 'weight_loss',
  startDate: '2030-10-10',
  endDate: '2030-11-09',
  allowLateJoin: true,
  lateJoinDeadline: 3,
};

/** iOS `CreateCircleRequest` (Core/Models/FitCircle.swift), encoded with `.iso8601` dates. */
const IOS_BODY = {
  name: 'Morning Crew',
  description: 'Up before the sun',
  type: 'weight_loss',
  visibility: 'private',
  start_date: '2030-10-10T19:12:33Z',
  end_date: '2030-11-09T19:12:33Z',
  min_participants: 2,
};

let db: CircleFakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = new CircleFakeDb();
  setCircleDb(db);
  requireMobileAuth.mockResolvedValue({ id: USER });
  checkCircleCreation.mockResolvedValue(null);
});

describe('POST /api/mobile/circles', () => {
  describe('old request shape (Android)', () => {
    it('creates the circle and answers { circle, inviteCode } as before', async () => {
      const res = await post(ANDROID_BODY);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.error).toBeNull();
      expect(body.data.circle).toMatchObject({
        name: 'Step Squad',
        type: 'weight_loss',
        creator_id: USER,
        start_date: '2030-10-10',
        end_date: '2030-11-09',
        allow_late_join: true,
        late_join_deadline: 3,
        status: 'upcoming',
      });
      expect(body.data.inviteCode).toMatch(/^FIT[A-Z0-9]{6}$/);
      expect(body.data.inviteCode).toBe(body.data.circle.invite_code);
    });

    it('sends no visibility, and none is written (the column default applies)', async () => {
      await post(ANDROID_BODY);

      const insert = db.log.find((entry) => entry.table === 'fitcircles' && entry.op === 'insert');
      expect(Object.keys(insert!.payload!)).not.toContain('visibility');
    });

    it('adds the creator as the first member', async () => {
      await post(ANDROID_BODY);
      expect(db.tables.fitcircle_members).toHaveLength(1);
      expect(db.tables.fitcircle_members[0]).toMatchObject({ user_id: USER, status: 'active' });
    });
  });

  describe('iOS request shape (snake_case, ISO datetimes)', () => {
    it('is accepted instead of failing with 400', async () => {
      const res = await post(IOS_BODY);
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.circle).toMatchObject({
        name: 'Morning Crew',
        description: 'Up before the sun',
        type: 'weight_loss',
        start_date: '2030-10-10',
        end_date: '2030-11-09',
      });
    });

    it('stores the visibility iOS sends', async () => {
      await post(IOS_BODY);
      expect(db.tables.fitcircles[0].visibility).toBe('private');

      await post({ ...IOS_BODY, name: 'Open', visibility: 'public' });
      expect(db.tables.fitcircles[1].visibility).toBe('public');

      await post({ ...IOS_BODY, name: 'Invite', visibility: 'invite_only' });
      expect(db.tables.fitcircles[2].visibility).toBe('invite_only');
    });

    it("uses the client's local day for an evening pick (x-client-timezone)", async () => {
      // 01:30 UTC on Oct 11 is 18:30 on Oct 10 in Los Angeles.
      const res = await post(
        { ...IOS_BODY, start_date: '2030-10-11T01:30:00Z', end_date: '2030-11-10T01:30:00Z' },
        { 'X-Client-Timezone': 'America/Los_Angeles' }
      );
      const body = await res.json();

      expect(body.data.circle.start_date).toBe('2030-10-10');
      expect(body.data.circle.end_date).toBe('2030-11-09');
    });

    it('falls back to the date part of the string without a timezone header', async () => {
      const res = await post({ ...IOS_BODY, start_date: '2030-10-11T01:30:00Z' });
      expect((await res.json()).data.circle.start_date).toBe('2030-10-11');
    });

    it('maps the legacy iOS type values', async () => {
      const res = await post({ ...IOS_BODY, type: 'steps' });
      expect((await res.json()).data.circle.type).toBe('step_count');
    });
  });

  describe('response decodes in every client', () => {
    it('iOS: `data` decodes as FitCircle (APIResponse<FitCircle>)', async () => {
      for (const requestBody of [IOS_BODY, ANDROID_BODY]) {
        const body = await (await post(requestBody)).json();
        expect(iosEnvelopeProblems(body)).toEqual([]);
        expect(iosFitCircleProblems(body.data)).toEqual([]);
        expect(body.data.id).toBe(body.data.circle.id);
        expect(body.data.name).toBe(body.data.circle.name);
      }
    });

    it('Android: `data.circle` and `data.inviteCode` are still there and unchanged', async () => {
      const body = await (await post(IOS_BODY)).json();

      expect(Object.keys(body.data)).toEqual(expect.arrayContaining(['circle', 'inviteCode']));
      expect(iosFitCircleProblems(body.data.circle)).toEqual([]);
      expect(typeof body.data.inviteCode).toBe('string');
      // The circle's own columns never shadow the two original keys.
      expect(typeof body.data.circle).toBe('object');
    });
  });

  describe('tolerance', () => {
    it('treats explicit nulls on optional fields as not sent', async () => {
      const res = await post({
        ...ANDROID_BODY,
        description: null,
        visibility: null,
        allowLateJoin: null,
        lateJoinDeadline: null,
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.data.circle.description).toBeNull();
      expect(body.data.circle.allow_late_join).toBe(true); // service default
      expect(Object.keys(db.log.find((e) => e.table === 'fitcircles')!.payload!)).not.toContain('visibility');
    });

    it('ignores a visibility it does not know instead of rejecting the request', async () => {
      const res = await post({ ...ANDROID_BODY, visibility: 'friends_only' });

      expect(res.status).toBe(201);
      expect(Object.keys(db.log.find((e) => e.table === 'fitcircles')!.payload!)).not.toContain('visibility');
    });
  });

  describe('errors keep their shape', () => {
    it('400 VALIDATION_ERROR with code, details and a readable message', async () => {
      const res = await post({ name: 'No dates' });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.data).toBeNull();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toMatchObject({ startDate: expect.any(String), endDate: expect.any(String) });
      expect(body.error.message).toContain('startDate');
      expect(typeof body.error.timestamp).toBe('string');
      expect(iosEnvelopeProblems(body)).toEqual([]);
      expect(db.tables.fitcircles).toHaveLength(0);
    });

    it('400 INVALID_DATE_RANGE when the end is not after the start (both shapes)', async () => {
      for (const requestBody of [
        { ...ANDROID_BODY, endDate: '2030-10-10' },
        { ...IOS_BODY, end_date: '2030-10-09T19:12:33Z' },
      ]) {
        const res = await post(requestBody);
        const body = await res.json();
        expect(res.status).toBe(400);
        expect(body.error.code).toBe('INVALID_DATE_RANGE');
      }
      expect(db.tables.fitcircles).toHaveLength(0);
    });

    it('403 UPGRADE_REQUIRED from the free-tier cap, unchanged', async () => {
      checkCircleCreation.mockResolvedValue({ used: 2, limit: 2 });
      const res = await post(IOS_BODY);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error.code).toBe('UPGRADE_REQUIRED');
      expect(body.error.details).toEqual({ feature: 'circles_unlimited', used: 2, limit: 2 });
    });

    it('401 when unauthenticated', async () => {
      requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
      const res = await post(ANDROID_BODY);
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    });
  });
});

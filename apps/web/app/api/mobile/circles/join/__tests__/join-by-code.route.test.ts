import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

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

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CREATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOINER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/mobile/circles/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any
  );

let db: CircleFakeDb;

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: JOINER });
  db = new CircleFakeDb();
  db.tables.fitcircles.push({
    id: CIRCLE,
    creator_id: CREATOR,
    name: 'Morning Crew',
    type: 'weight_loss',
    status: 'upcoming',
    visibility: 'private',
    invite_code: 'FITABC234',
    start_date: inDays(3),
    end_date: inDays(33),
    participant_count: 1,
    allow_late_join: true,
    late_join_deadline: 3,
  });
  db.tables.fitcircle_members.push({ id: 'm1', fitcircle_id: CIRCLE, user_id: CREATOR, status: 'active' });
  setCircleDb(db);
});

/** The route Android uses (`JoinByCodeRequest` / `JoinByCodeResponse`). Its contract must not move. */
describe('POST /api/mobile/circles/join', () => {
  it('joins by code and answers { success, circle, message } (201)', async () => {
    const res = await post({ inviteCode: 'fitabc234' });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(Object.keys(body).sort()).toEqual(['circle', 'message', 'success']);
    expect(body.success).toBe(true);
    expect(body.circle.id).toBe(CIRCLE);
    expect(body.message).toBe('Successfully joined the circle');
  });

  it('records the creator as the inviter (reads fitcircles.creator_id, which exists)', async () => {
    await post({ inviteCode: 'FITABC234' });

    const joined = db.tables.fitcircle_members.find((m) => m.user_id === JOINER);
    expect(joined).toMatchObject({ fitcircle_id: CIRCLE, invited_by: CREATOR, status: 'active' });
    expect(db.tables.fitcircles[0].participant_count).toBe(2);
  });

  it('tolerates `goal: null` (kotlinx encodes unset optionals as null)', async () => {
    const res = await post({ inviteCode: 'FITABC234', goal: null });
    expect(res.status).toBe(201);
  });

  it('409 with { error, message } when already a member', async () => {
    requireMobileAuth.mockResolvedValue({ id: CREATOR });
    const res = await post({ inviteCode: 'FITABC234' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Already a member',
      message: 'You are already a member of this circle',
    });
  });

  it('400 with { error, message } for an unknown code', async () => {
    const res = await post({ inviteCode: 'FITNOPE99' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid invite', message: 'Invalid invite code' });
  });

  it('400 validation error body is exactly what it was', async () => {
    const res = await post({});
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(Object.keys(body).sort()).toEqual(['details', 'error', 'message']);
    expect(body.error).toBe('Validation error');
    expect(body.message).toBe('Invalid input data');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('401 with { error, message } when unauthenticated', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await post({ inviteCode: 'FITABC234' });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized', message: 'Invalid or expired token' });
  });
});

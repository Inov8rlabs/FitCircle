import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  createChallenge: vi.fn(),
  getCircleChallenges: vi.fn(),
  sendHighFive: vi.fn(),
}));

vi.mock('@/lib/services/circle-challenge-service', () => ({ ChallengeService: service }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return { id: 'user-1' };
  },
}));

import { POST as highFive } from '../[challengeId]/high-fives/route';
import { POST as create } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CHALLENGE = '33333333-3333-4333-8333-333333333333';
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const post = (handler: any, params: Record<string, string>, body: unknown, authed = true) =>
  handler(
    new Request('http://localhost/api/fitcircles/x/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authed ? { Authorization: 'Bearer t' } : {}) },
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve(params) }
  );

const required = {
  name: '500 Pushups',
  category: 'strength',
  goal_amount: 500,
  unit: 'reps',
  starts_at: '2026-09-28T12:00:00Z',
  ends_at: '2026-10-05T12:00:00Z',
};
const created = { id: CHALLENGE, ...required, status: 'active', category_raw: 'strength' };

beforeEach(() => {
  service.createChallenge.mockReset().mockResolvedValue(created);
  service.sendHighFive.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/fitcircles/[id]/challenges', () => {
  it('accepts explicit nulls for every optional field (what Android sent for "from scratch")', async () => {
    const res = await post(create, { id: CIRCLE }, {
      ...required,
      template_id: null,
      description: null,
      logging_prompt: null,
      is_open: null,
      invite_user_ids: null,
    });

    expect(res.status).toBe(200);
    expect(service.createChallenge).toHaveBeenCalledWith('user-1', { ...required, fitcircle_id: CIRCLE });
  });

  it('still accepts the shape iOS sends (optional keys omitted or filled)', async () => {
    expect((await post(create, { id: CIRCLE }, { ...required, is_open: true })).status).toBe(200);
    expect(service.createChallenge).toHaveBeenLastCalledWith('user-1', { ...required, is_open: true, fitcircle_id: CIRCLE });

    const full = {
      ...required,
      template_id: 'pushups-25-daily',
      description: 'Every day',
      logging_prompt: 'How many?',
      is_open: false,
      invite_user_ids: [BEN],
    };
    expect((await post(create, { id: CIRCLE }, full)).status).toBe(200);
    expect(service.createChallenge).toHaveBeenLastCalledWith('user-1', { ...full, fitcircle_id: CIRCLE });
  });

  it('returns the challenge untouched in the same envelope', async () => {
    const body = await (await post(create, { id: CIRCLE }, required)).json();
    expect(body).toEqual({ success: true, data: created, error: null });
  });

  it('still rejects a missing or null required field and an unknown category', async () => {
    for (const bad of [
      { ...required, name: null },
      { ...required, goal_amount: null },
      { ...required, category: 'mixed' },
      { ...required, goal_amount: -1 },
      { ...required, name: 'ab' },
    ]) {
      const res = await post(create, { id: CIRCLE }, bad);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(service.createChallenge).not.toHaveBeenCalled();
  });

  it('keeps code + details (the zod issue array) and makes the message specific', async () => {
    const body = await (await post(create, { id: CIRCLE }, { ...required, name: 'ab' })).json();

    expect(body.success).toBe(false);
    expect(body.data).toBeNull();
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message']);
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details[0].path).toEqual(['name']);
    expect(body.error.message).toBe('name: String must contain at least 3 character(s)');
  });

  it('still answers 401 without a token and 400 ERROR for a service failure', async () => {
    expect((await post(create, { id: CIRCLE }, required, false)).status).toBe(401);

    service.createChallenge.mockRejectedValueOnce(new Error('You must be an active member of this circle'));
    const res = await post(create, { id: CIRCLE }, required);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ code: 'ERROR', message: 'You must be an active member of this circle' });
  });
});

describe('POST .../high-fives', () => {
  it('accepts the body both apps send', async () => {
    const res = await post(highFive, { id: CIRCLE, challengeId: CHALLENGE }, { to_user_id: BEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: null, error: null });
    expect(service.sendHighFive).toHaveBeenCalledWith(CHALLENGE, 'user-1', BEN);
  });

  it('answers 400 with a readable message when to_user_id is null, missing or not a uuid', async () => {
    for (const bad of [{ to_user_id: null }, {}, { to_user_id: 'ben' }]) {
      const res = await post(highFive, { id: CIRCLE, challengeId: CHALLENGE }, bad);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/^to_user_id: /);
      expect(Array.isArray(body.error.details)).toBe(true);
    }
    expect(service.sendHighFive).not.toHaveBeenCalled();
  });
});

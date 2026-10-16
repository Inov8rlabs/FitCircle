import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralError } from '@/lib/referrals/types';

const getUser = vi.fn();
const getHub = vi.fn();
const markRewardsSeen = vi.fn();
const claim = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: () => getUser() } }),
}));
vi.mock('@/lib/services/referral-service', () => ({
  ReferralService: {
    getHub: (...a: unknown[]) => getHub(...a),
    markRewardsSeen: (...a: unknown[]) => markRewardsSeen(...a),
    claim: (...a: unknown[]) => claim(...a),
  },
}));

import { POST as CLAIM } from '../claim/route';
import { GET } from '../me/route';
import { POST as SEEN } from '../me/seen/route';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'a@b.co' };
const REWARD_ID = '22222222-2222-4222-8222-222222222222';

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
});

describe('GET /api/referrals/me', () => {
  it('401s without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(getHub).not.toHaveBeenCalled();
  });

  it('returns the hub in the standard envelope', async () => {
    const hub = { enabled: true, code: 'MAYA7K2', stats: { qualified: 2 } };
    getHub.mockResolvedValue(hub);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getHub).toHaveBeenCalledWith(USER.id);
    expect(body).toMatchObject({ success: true, data: hub, error: null });
    expect(body.meta).toHaveProperty('requestTime');
  });

  it('passes enabled:false through untouched', async () => {
    getHub.mockResolvedValue({ enabled: false });
    const body = await (await GET()).json();
    expect(body.data).toEqual({ enabled: false });
  });

  it('500s with an envelope when the service throws', async () => {
    getHub.mockRejectedValue(new Error('db down'));
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});

describe('POST /api/referrals/me/seen', () => {
  it('marks the given rewards as seen', async () => {
    markRewardsSeen.mockResolvedValue(1);
    const res = await SEEN(post('http://localhost/api/referrals/me/seen', { ids: [REWARD_ID] }));
    expect(res.status).toBe(200);
    expect(markRewardsSeen).toHaveBeenCalledWith(USER.id, [REWARD_ID]);
    expect((await res.json()).data).toEqual({ updated: 1 });
  });

  it('rejects bad bodies', async () => {
    const res = await SEEN(post('http://localhost/api/referrals/me/seen', { ids: ['nope'] }));
    expect(res.status).toBe(400);
    expect(markRewardsSeen).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await SEEN(post('http://localhost/api/referrals/me/seen', { ids: [REWARD_ID] }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/referrals/claim (web signup attribution)', () => {
  const result = { status: 'pending', inviter: { firstName: 'Maya', avatarUrl: null }, circle: null, inviteeRewardDays: 7 };

  it('claims an explicit personal ref with source web and clears fc_ref', async () => {
    claim.mockResolvedValue(result);
    const res = await CLAIM(post('http://localhost/api/referrals/claim', { ref: 'maya7k2' }));
    expect(claim).toHaveBeenCalledWith(USER.id, { code: 'MAYA7K2', ref: null, source: 'web' });
    const body = await res.json();
    expect(body.data).toMatchObject({ claimed: true, status: 'pending' });
    expect(res.headers.get('set-cookie')).toMatch(/fc_ref=;.*Max-Age=0/i);
  });

  it('claims a circle invite as {code: circle, ref}', async () => {
    claim.mockResolvedValue(result);
    await CLAIM(post('http://localhost/api/referrals/claim', { ref: 'MAYA7K2', circle: 'FITAB12CD' }));
    expect(claim).toHaveBeenCalledWith(USER.id, { code: 'FITAB12CD', ref: 'MAYA7K2', source: 'web' });
  });

  it('falls back to the fc_ref cookie', async () => {
    claim.mockResolvedValue(result);
    const cookie = `fc_ref=${encodeURIComponent(
      JSON.stringify({ code: 'FITAB12CD', ref: 'MAYA7K2', circle: 'FITAB12CD', ts: Date.now() })
    )}`;
    await CLAIM(post('http://localhost/api/referrals/claim', undefined, { cookie }));
    expect(claim).toHaveBeenCalledWith(USER.id, { code: 'FITAB12CD', ref: 'MAYA7K2', source: 'web' });
  });

  it('swallows ReferralErrors (200, claimed:false) and still clears the cookie', async () => {
    claim.mockRejectedValue(new ReferralError('ALREADY_ATTRIBUTED', 'already'));
    const res = await CLAIM(post('http://localhost/api/referrals/claim', { ref: 'MAYA7K2' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ claimed: false, reason: 'ALREADY_ATTRIBUTED' });
    expect(res.headers.get('set-cookie')).toMatch(/fc_ref=/);
  });

  it('keeps the cookie on unexpected errors so a later retry can use it', async () => {
    claim.mockRejectedValue(new Error('boom'));
    const res = await CLAIM(post('http://localhost/api/referrals/claim', { ref: 'MAYA7K2' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ claimed: false, reason: 'ERROR' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('uses source typed for the hub form', async () => {
    claim.mockResolvedValue(result);
    await CLAIM(post('http://localhost/api/referrals/claim', { code: 'MAYA7K2', source: 'typed' }));
    expect(claim).toHaveBeenCalledWith(USER.id, { code: 'MAYA7K2', ref: null, source: 'typed' });
  });

  it('reports NO_INVITE when nothing to claim', async () => {
    const res = await CLAIM(post('http://localhost/api/referrals/claim', {}));
    expect((await res.json()).data).toEqual({ claimed: false, reason: 'NO_INVITE' });
    expect(claim).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await CLAIM(post('http://localhost/api/referrals/claim', { ref: 'MAYA7K2' }));
    expect(res.status).toBe(401);
  });
});

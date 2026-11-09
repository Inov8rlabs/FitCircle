/** Refresh + integrity bypass: the user id / email come from a verified refresh token, never the client. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  allowed: false,
  bypassUsers: [] as string[],
  reviewerEmails: [] as string[],
  verified: null as null | { userId: string; email?: string },
  bypassCalls: [] as any[],
}));

vi.mock('@/lib/security/abuse-limits', () => ({ enforceAbuseLimits: async () => null }));
vi.mock('@/lib/integrity/enforcement', () => ({
  checkIntegrity: async () =>
    h.allowed
      ? { allowed: true, mode: 'legacy', deviceId: null, attestedDeviceId: null }
      : { allowed: false, mode: 'blocked', reason: 'device_integrity', bypassEligible: true, deviceId: 'dev-1', attestedDeviceId: null, response: new Response(JSON.stringify({ code: 'INTEGRITY_FAILED' }), { status: 403 }) },
  resolveBypass: async (_r: unknown, _d: unknown, identity: { userId: string | null; email: string | null }, action: string) => {
    h.bypassCalls.push({ ...identity, action });
    return (!!identity.userId && h.bypassUsers.includes(identity.userId)) || (!!identity.email && h.reviewerEmails.includes(identity.email));
  },
  recordSessionAttestation: async () => {},
  userIdFromAccessToken: () => 'u-1',
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    verifyRefreshToken: async () => h.verified,
    refreshAccessToken: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_at: 2_000_000_000, token_type: 'Bearer' }),
  },
}));

import { POST } from '../../refresh/route';

const post = () => POST(new Request('http://localhost/api/mobile/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: 'rt' }), headers: { 'content-type': 'application/json' } }) as any);

beforeEach(() => {
  h.allowed = false;
  h.bypassUsers = [];
  h.reviewerEmails = [];
  h.verified = null;
  h.bypassCalls = [];
});

describe('POST /api/mobile/auth/refresh with a failing device', () => {
  it('a bypass-listed user (from the verified refresh token) gets new tokens', async () => {
    h.verified = { userId: 'u-1' };
    h.bypassUsers = ['u-1'];
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.bypassCalls).toEqual([{ userId: 'u-1', email: null, action: 'refresh' }]);
    expect((await res.json()).session.access_token).toBe('a2');
  });

  it('anyone else gets the 403 (client logs out)', async () => {
    h.verified = { userId: 'u-2' };
    h.bypassUsers = ['u-1'];
    expect((await post()).status).toBe(403);
  });

  it('an invalid refresh token never reaches the bypass list', async () => {
    h.bypassUsers = ['u-1'];
    expect((await post()).status).toBe(403);
    expect(h.bypassCalls).toEqual([{ userId: null, email: null, action: 'refresh' }]);
  });

  it('a reviewer (email signed into the verified refresh token) gets new tokens', async () => {
    h.verified = { userId: 'u-9', email: 'fitcircle.user@gmail.com' };
    h.reviewerEmails = ['fitcircle.user@gmail.com'];
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.bypassCalls).toEqual([{ userId: 'u-9', email: 'fitcircle.user@gmail.com', action: 'refresh' }]);
  });
});

/**
 * Login + integrity bypass: the identity passed to resolveBypass is the account the
 * password check verified (its own id and email), never the typed email on a failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  allowed: false,
  bypassEligible: true,
  signIn: { ok: true, email: 'fitcircle.user@gmail.com' } as { ok: boolean; email: string },
  reviewerEmails: [] as string[],
  bypassCalls: [] as any[],
  attestations: 0,
}));

vi.mock('@/lib/security/abuse-limits', () => ({ enforceAbuseLimits: async () => null, requestDeviceId: () => 'dev-1' }));
vi.mock('@/lib/security/security-events', () => ({ recordSecurityEvent: async () => {} }));
vi.mock('@/lib/integrity/enforcement', () => ({
  checkIntegrity: async () =>
    h.allowed
      ? { allowed: true, mode: 'legacy', deviceId: null, attestedDeviceId: null }
      : {
          allowed: false,
          mode: 'blocked',
          reason: 'missing_token',
          bypassEligible: h.bypassEligible,
          deviceId: 'dev-1',
          attestedDeviceId: null,
          response: new Response(JSON.stringify({ code: 'INTEGRITY_FAILED' }), { status: 403 }),
        },
  resolveLoginBypass: async (_r: unknown, _d: unknown, identity: { userId: string | null; email: string | null }) => {
    h.bypassCalls.push(identity);
    return !!identity.email && h.reviewerEmails.includes(identity.email);
  },
  recordSessionAttestation: async () => void h.attestations++,
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: { generateTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: 2_000_000_000 }) },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () =>
        h.signIn.ok
          ? { data: { user: { id: 'u-1', email: h.signIn.email }, session: { access_token: 'sb' } }, error: null }
          : { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'u-1', email: h.signIn.email } }) }) }) }),
  }),
}));

import { POST } from '../route';

const post = (email = 'FitCircle.User@gmail.com') =>
  POST(new Request('http://localhost/api/mobile/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'pw' }), headers: { 'content-type': 'application/json' } }) as any);

beforeEach(() => {
  Object.assign(h, { allowed: false, bypassEligible: true, signIn: { ok: true, email: 'fitcircle.user@gmail.com' }, reviewerEmails: [], bypassCalls: [], attestations: 0 });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

describe('POST /api/mobile/auth/login with a failing device', () => {
  it('the reviewer (verified by the password check) signs in', async () => {
    h.reviewerEmails = ['fitcircle.user@gmail.com'];
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.bypassCalls).toEqual([{ userId: 'u-1', email: 'fitcircle.user@gmail.com' }]);
    expect((await res.json()).data.access_token).toBe('a');
  });

  it('a wrong password never reaches the lists with an identity (403, not 401)', async () => {
    h.reviewerEmails = ['fitcircle.user@gmail.com'];
    h.signIn = { ok: false, email: '' };
    const res = await post();
    expect(res.status).toBe(403);
    expect(h.bypassCalls).toEqual([{ userId: null, email: null }]);
  });

  it('anyone else gets the 403', async () => {
    h.reviewerEmails = ['fitcircle.user@gmail.com'];
    h.signIn = { ok: true, email: 'someone@gmail.com' };
    expect((await post('someone@gmail.com')).status).toBe(403);
  });

  it('a non-bypassable block returns 403 before the password check', async () => {
    h.bypassEligible = false;
    expect((await post()).status).toBe(403);
    expect(h.bypassCalls).toEqual([]);
  });
});

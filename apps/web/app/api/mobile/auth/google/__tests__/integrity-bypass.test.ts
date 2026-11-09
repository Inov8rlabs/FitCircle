/**
 * Google sign-in + integrity: a blocked device is let through only for an email on
 * integrity_reviewer_emails taken from an id token that VERIFIES with email_verified, and
 * the decision happens before any account is created.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  allowed: false,
  bypassEligible: true,
  token: { sub: 'g-1', email: 'robot.12345@cloudtestlabaccounts.com', email_verified: true } as Record<string, unknown> | null,
  reviewerEmails: [] as string[],
  bypassCalls: [] as any[],
  created: [] as any[],
}));

vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => {
    if (!h.token) throw new Error('bad signature');
    return { payload: { iss: 'https://accounts.google.com', aud: 'x', exp: 2_000_000_000, iat: 1, ...h.token } };
  },
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
  resolveBypass: async (_r: unknown, _d: unknown, identity: { email: string | null }, action: string) => {
    h.bypassCalls.push({ ...identity, action });
    return !!identity.email && h.reviewerEmails.includes(identity.email);
  },
  recordSessionAttestation: async () => {},
}));
vi.mock('@/lib/services/social-auth-service', () => ({
  SocialAuthError: class extends Error {},
  findOrCreateSocialUser: async (_s: unknown, input: any) => (h.created.push(input), { userId: 'u-1', profile: { id: 'u-1' }, isNewUser: false }),
}));
vi.mock('@/lib/services/test-device-service', () => ({ recordTestDeviceSignal: async () => {}, isTestDeviceRequest: () => false }));
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
vi.mock('@/lib/services/email-signup-service', () => ({ setEmailCanonical: async () => {} }));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: { generateTokens: async () => ({ access_token: 'a', refresh_token: 'r', expires_at: 2_000_000_000 }) },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

import { POST } from '../route';

const post = () =>
  POST(new Request('http://localhost/api/mobile/auth/google', { method: 'POST', body: JSON.stringify({ idToken: 'id-tok' }), headers: { 'content-type': 'application/json' } }) as any);

beforeEach(() => {
  Object.assign(h, {
    allowed: false,
    bypassEligible: true,
    token: { sub: 'g-1', email: 'robot.12345@cloudtestlabaccounts.com', email_verified: true },
    reviewerEmails: [],
    bypassCalls: [],
    created: [],
  });
});

describe('POST /api/mobile/auth/google with a failing device', () => {
  it('a reviewer / pre-launch robot with a verified Google email signs in', async () => {
    h.reviewerEmails = ['robot.12345@cloudtestlabaccounts.com'];
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.bypassCalls).toEqual([{ email: 'robot.12345@cloudtestlabaccounts.com', action: 'google' }]);
    expect(h.created).toHaveLength(1);
  });

  it('a non-reviewer gets the 403 and no account is created', async () => {
    const res = await post();
    expect(res.status).toBe(403);
    expect(h.created).toEqual([]);
  });

  it('an email Google does not mark verified never reaches the list', async () => {
    h.reviewerEmails = ['robot.12345@cloudtestlabaccounts.com'];
    h.token = { sub: 'g-1', email: 'robot.12345@cloudtestlabaccounts.com', email_verified: false };
    expect((await post()).status).toBe(403);
    expect(h.bypassCalls).toEqual([{ email: null, action: 'google' }]);
  });

  it('accepts the legacy string "true" for email_verified', async () => {
    h.reviewerEmails = ['robot.12345@cloudtestlabaccounts.com'];
    h.token = { sub: 'g-1', email: 'robot.12345@cloudtestlabaccounts.com', email_verified: 'true' };
    expect((await post()).status).toBe(200);
  });

  it('an invalid id token on a blocked device gets the 403 (block recorded), not a 401', async () => {
    h.reviewerEmails = ['robot.12345@cloudtestlabaccounts.com'];
    h.token = null;
    expect((await post()).status).toBe(403);
    expect(h.bypassCalls).toEqual([{ email: null, action: 'google' }]);
  });

  it('a non-bypassable block returns 403 before the token is verified', async () => {
    h.bypassEligible = false;
    expect((await post()).status).toBe(403);
    expect(h.bypassCalls).toEqual([]);
  });

  it('an allowed device is unaffected (invalid token → 401)', async () => {
    h.allowed = true;
    h.token = null;
    expect((await post()).status).toBe(401);
    expect(h.bypassCalls).toEqual([]);
  });
});

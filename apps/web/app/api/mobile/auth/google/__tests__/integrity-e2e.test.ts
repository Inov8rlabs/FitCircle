/**
 * Google sign-in with the REAL integrity check (only Google Play Integrity, the Google id
 * token check, the nonce store and the DB stubbed): a genuine device is VERIFIED, never
 * failed open (2026-11-11 incident).
 */
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/remote-config/service', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).remoteConfigModule());
vi.mock('@/lib/security/security-events', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).securityEventsModule(await orig()));
vi.mock('@/lib/integrity/attestations', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).attestationsModule());
vi.mock('@/lib/integrity/nonce', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).nonceModule(await orig()));
vi.mock('@/lib/security/abuse-limits', async (orig) => ({ ...(await orig<Record<string, unknown>>()), enforceAbuseLimits: async () => null }));
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: { iss: 'https://accounts.google.com', aud: 'x', exp: 2_000_000_000, iat: 1, sub: 'g-1', email: 'g.user@gmail.com', email_verified: true } }),
}));
vi.mock('@/lib/services/social-auth-service', () => ({
  SocialAuthError: class extends Error {},
  findOrCreateSocialUser: async () => ({ userId: 'u-google', profile: { id: 'u-google' }, isNewUser: false }),
}));
vi.mock('@/lib/services/test-device-service', () => ({ recordTestDeviceSignal: async () => {}, isTestDeviceRequest: () => false }));
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
vi.mock('@/lib/services/email-signup-service', () => ({ setEmailCanonical: async () => {} }));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    generateTokens: async (userId: string) => ({ access_token: jwt.sign({ userId, sid: 'sess-google', type: 'access' }, 'k'), refresh_token: 'r', expires_at: 2_000_000_000 }),
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));

import { expectVerified, expectVerifiedSession, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

beforeEach(() => installIntegrity());

describe('POST /api/mobile/auth/google — real integrity check', () => {
  it('a genuine Play device is verified (pass), signs in, and the session is attested', async () => {
    const res = await POST(await signedRequest({ path: '/api/mobile/auth/google', body: { idToken: 'google-id-token' } }));
    expect(res.status).toBe(200);
    expectVerified(res, 'google');
    expectVerifiedSession('u-google');
  });
});

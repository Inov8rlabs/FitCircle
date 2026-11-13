/**
 * Register with the REAL integrity check (only Google, the nonce store and the DB stubbed):
 * a genuine device is VERIFIED, never failed open (2026-11-11 incident; see
 * lib/integrity/__tests__/e2e-harness.ts).
 */
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/remote-config/service', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).remoteConfigModule());
vi.mock('@/lib/security/security-events', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).securityEventsModule(await orig()));
vi.mock('@/lib/integrity/attestations', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).attestationsModule());
vi.mock('@/lib/integrity/nonce', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).nonceModule(await orig()));
vi.mock('@/lib/security/abuse-limits', async (orig) => ({ ...(await orig<Record<string, unknown>>()), enforceAbuseLimits: async () => null }));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    generateTokens: async (userId: string) => ({ access_token: jwt.sign({ userId, sid: 'sess-register', type: 'access' }, 'k'), refresh_token: 'r', expires_at: 2_000_000_000 }),
  },
}));
vi.mock('@/lib/services/email-signup-service', () => ({
  signupRequiresConfirmation: () => false,
  createEmailAccount: async (_s: unknown, input: { email: string }) => ({ ok: true, user: { id: 'u-register', email: input.email } }),
  sendSignupConfirmation: async () => {},
  setEmailCanonical: async () => {},
}));
vi.mock('@/lib/services/test-device-service', () => ({ recordTestDeviceSignal: async () => {}, isTestDeviceRequest: () => false }));
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ ilike: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      insert: (row: any) => ({ select: () => ({ single: async () => ({ data: { ...row }, error: null }) }) }),
    }),
    auth: { admin: { deleteUser: async () => ({}) } },
  }),
}));

import { expectVerified, expectVerifiedSession, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

beforeEach(() => {
  installIntegrity();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

describe('POST /api/mobile/auth/register — real integrity check', () => {
  it('a genuine Play device is verified (pass), the account is created, and the session is attested', async () => {
    const res = await POST(
      await signedRequest({ path: '/api/mobile/auth/register', body: { email: 'new.user@example.com', password: 'longenough', displayName: 'New User' } })
    );
    expect(res.status).toBe(201);
    expectVerified(res, 'register');
    expectVerifiedSession('u-register');
  });
});

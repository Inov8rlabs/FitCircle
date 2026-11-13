/**
 * Login with the REAL integrity check (only Google, the nonce store and the DB stubbed):
 * a genuine device is VERIFIED, never failed open. Fails on the pre-a63d92e ordering
 * (route read `await request.json()` before checkIntegrity → 2026-11-11 incident).
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
    generateTokens: async (userId: string) => ({ access_token: jwt.sign({ userId, sid: 'sess-login', type: 'access' }, 'k'), refresh_token: 'r', expires_at: 2_000_000_000 }),
  },
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { signInWithPassword: async () => ({ data: { user: { id: 'u-login', email: 'a@b.co' }, session: { access_token: 'sb' } }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'u-login', email: 'a@b.co' } }) }) }) }),
  }),
}));

import { expectVerified, expectVerifiedSession, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

beforeEach(() => {
  installIntegrity();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://x';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
});

describe('POST /api/mobile/auth/login — real integrity check', () => {
  it('a genuine Play device is verified (pass), signs in, and the session is attested', async () => {
    const res = await POST(await signedRequest({ path: '/api/mobile/auth/login', body: { email: 'a@b.co', password: 'pw' } }));
    expect(res.status).toBe(200);
    expectVerified(res, 'login');
    expectVerifiedSession('u-login');
  });
});

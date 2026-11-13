/**
 * Refresh with the REAL integrity check (only Google, the nonce store and the DB stubbed):
 * a genuine device is VERIFIED, never failed open (2026-11-11 incident).
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
    verifyRefreshToken: async () => null,
    refreshAccessToken: async () => ({ access_token: jwt.sign({ userId: 'u-refresh', sid: 'sess-refresh', type: 'access' }, 'k'), refresh_token: 'r2', expires_at: 2_000_000_000, token_type: 'Bearer' }),
  },
}));

import { expectVerified, expectVerifiedSession, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

beforeEach(() => installIntegrity());

describe('POST /api/mobile/auth/refresh — real integrity check', () => {
  it('a genuine Play device is verified (pass), gets new tokens, and the new session is attested', async () => {
    const res = await POST(await signedRequest({ path: '/api/mobile/auth/refresh', body: { refresh_token: 'rt' } }));
    expect(res.status).toBe(200);
    expectVerified(res, 'refresh');
    expectVerifiedSession('u-refresh');
  });
});

/**
 * POST /api/mobile/referrals/claim
 * with the REAL integrity check (only Google, the nonce store and the DB stubbed): a
 * genuine device with no live session attestation sends a token and is VERIFIED, never
 * failed open (2026-11-11 incident; lib/integrity/__tests__/e2e-harness.ts).
 */
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/remote-config/service', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).remoteConfigModule());
vi.mock('@/lib/security/security-events', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).securityEventsModule(await orig()));
vi.mock('@/lib/integrity/attestations', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).attestationsModule());
vi.mock('@/lib/integrity/nonce', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).nonceModule(await orig()));
vi.mock('@/lib/security/abuse-limits', async (orig) => ({ ...(await orig<Record<string, unknown>>()), enforceAbuseLimits: async () => null }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: async () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('@/lib/middleware/rate-limit', async (orig) => ({ ...(await orig<Record<string, unknown>>()), applyRateLimit: async () => null }));
const claims: any[] = [];
vi.mock('@/lib/referrals/accept-invite', () => ({
  acceptInvite: async (_u: string, input: any) => (claims.push(input), { referral: { claimed: true, result: { referralId: 'ref-1' } }, circleJoin: null }),
}));

import { E2E_USER_ID, expectVerified, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';
import { E2E_DEVICE_ID } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

const bearer = () => jwt.sign({ userId: E2E_USER_ID, sid: 'sess-1', type: 'access' }, 'k');

beforeEach(() => {
  installIntegrity();
  claims.length = 0;
});

describe('POST /api/mobile/referrals/claim — real integrity check', () => {
  it('a genuine Play device is verified (pass), and the claim carries the attested device id', async () => {
    const res = await POST(await signedRequest({ path: '/api/mobile/referrals/claim', body: { code: 'ABC123', source: 'typed' }, bearer: bearer() }));
    expect(res.status).toBe(200);
    expect(claims[0]).toMatchObject({ attestedDeviceId: E2E_DEVICE_ID, integrityClient: true });
    expectVerified(res, 'referral_claim');
  });
});

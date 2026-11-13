/**
 * POST /api/mobile/fitzy/chat
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
vi.mock('@/lib/services/consent-service', async (orig) => (await import('@/lib/services/__tests__/consent-stub')).allowAllConsentModule(orig));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: () => {} }));
vi.mock('@/lib/services/journey-service', () => ({ JourneyService: { markFitzyOpened: async () => {} } }));
vi.mock('@/lib/services/fitzy-service', () => ({
  FitzyService: { chat: async (_u: string, messages: Array<{ content: string }>) => ({ answer: `echo: ${messages.at(-1)?.content}`, disclaimer: '', suggestions: [], actions: [] }) },
}));

import { E2E_USER_ID, expectVerified, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

const bearer = () => jwt.sign({ userId: E2E_USER_ID, sid: 'sess-1', type: 'access' }, 'k');

beforeEach(() => installIntegrity());

describe('POST /api/mobile/fitzy/chat — real integrity check', () => {
  it('a genuine Play device is verified (pass), and Fitzy answers', async () => {
    const res = await POST(await signedRequest({ path: '/api/mobile/fitzy/chat', body: { messages: [{ role: 'user', content: 'hi' }] }, bearer: bearer() }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('echo: hi');
    expectVerified(res, 'fitzy');
  });
});

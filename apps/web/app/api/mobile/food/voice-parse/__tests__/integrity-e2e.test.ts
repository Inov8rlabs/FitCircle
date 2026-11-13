/**
 * POST /api/mobile/food/voice-parse
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
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }));
vi.mock('@/lib/services/nutrition-intelligence-service', () => ({
  NutritionIntelligenceService: { parseVoice: async (_u: string, transcript: string) => ({ items: [], totals: {}, overallConfidence: 0.9, transcript }) },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({ NutritionTrainingService: { captureDraft: async () => {} } }));

import { E2E_USER_ID, expectVerified, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

const bearer = () => jwt.sign({ userId: E2E_USER_ID, sid: 'sess-1', type: 'access' }, 'k');

beforeEach(() => installIntegrity());

describe('POST /api/mobile/food/voice-parse — real integrity check', () => {
  it('a genuine Play device is verified (pass), and the transcript is parsed', async () => {
    const res = await POST(await signedRequest({ path: '/api/mobile/food/voice-parse', body: { transcript: 'two eggs and toast' }, bearer: bearer() }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.transcript).toBe('two eggs and toast');
    expectVerified(res, 'food_ai');
  });
});

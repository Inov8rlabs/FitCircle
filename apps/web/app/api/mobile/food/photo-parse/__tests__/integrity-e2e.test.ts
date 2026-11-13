/**
 * POST /api/mobile/food/photo-parse (multipart)
 * with the REAL integrity check (only Google, the nonce store and the DB stubbed): a
 * genuine device with no live session attestation sends a token and is VERIFIED, never
 * failed open (2026-11-11 incident; lib/integrity/__tests__/e2e-harness.ts).
 */
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/remote-config/service', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).remoteConfigModule());
vi.mock('@/lib/security/security-events', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).securityEventsModule(await orig()));
vi.mock('@/lib/integrity/attestations', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).attestationsModule());
vi.mock('@/lib/integrity/nonce', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).nonceModule(await orig()));
vi.mock('@/lib/security/abuse-limits', async (orig) => ({ ...(await orig<Record<string, unknown>>()), enforceAbuseLimits: async () => null }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: async () => ({ id: '11111111-1111-4111-8111-111111111111' }) }));
vi.mock('@/lib/services/consent-service', async (orig) => (await import('@/lib/services/__tests__/consent-stub')).allowAllConsentModule(orig));
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: () => {} }));
vi.mock('@/lib/services/nutrition-intelligence-service', () => ({
  NutritionIntelligenceService: { parsePhoto: async (_u: string, images: unknown[]) => ({ items: [], totals: {}, overallConfidence: 0.9, imageCount: images.length }) },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({ NutritionTrainingService: { captureDraft: async () => {} } }));

import { E2E_USER_ID, expectVerified, installIntegrity, signedRequest } from '@/lib/integrity/__tests__/e2e-harness';
import { multipartBody } from '@/lib/integrity/__tests__/e2e-harness';

import { POST } from '../route';

const bearer = () => jwt.sign({ userId: E2E_USER_ID, sid: 'sess-1', type: 'access' }, 'k');

// jsdom replaces the global File; undici's formData() (what the route uses in production)
// needs Node's own File to build the parts.
const jsdomFile = globalThis.File;
beforeAll(async () => {
  globalThis.File = (await import('node:buffer')).File as unknown as typeof File;
});
afterAll(() => {
  globalThis.File = jsdomFile;
});

beforeEach(() => installIntegrity());

describe('POST /api/mobile/food/photo-parse — real integrity check', () => {
  it('a genuine Play device is verified (pass) over the raw multipart bytes, and the photo is parsed', async () => {
    const { body, contentType } = multipartBody({ note: 'lunch' });
    const res = await POST(await signedRequest({ path: '/api/mobile/food/photo-parse', body, headers: { 'content-type': contentType }, bearer: bearer() }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.imageCount).toBe(1);
    expectVerified(res, 'food_ai');
  });
});

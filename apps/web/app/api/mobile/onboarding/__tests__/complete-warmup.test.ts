/** POST /api/mobile/onboarding/complete schedules the free plan preview (TRIAL_FIRST_SPEC §3). */
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tasks: [] as Array<() => unknown>, warmed: [] as Array<[string, string | null | undefined]> }));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: (t: () => unknown) => void h.tasks.push(t) }));
vi.mock('@/lib/fitzy/plan-warmup', () => ({ warmFitzyPlanPreview: async (id: string, tz?: string | null) => void h.warmed.push([id, tz]) }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/services/assessment-service', () => ({ AssessmentService: { completeOnboarding: async () => ({ success: true, xpAwarded: 0 }) } }));
vi.mock('@/lib/services/mobile-api-service', () => ({ MobileAPIService: { getUserProfileWithStats: async () => ({ id: 'user-1' }) } }));
vi.mock('@/lib/services/onboarding-flow-service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  OnboardingFlowService: { saveBirthDate: async () => undefined },
}));

import { POST } from '../complete/route';

describe('onboarding complete → eager plan preview', () => {
  it('runs the warm-up after the response with the client timezone', async () => {
    const res = await POST(new NextRequest('https://www.fitcircle.ai/api/mobile/onboarding/complete', { method: 'POST', headers: { 'x-client-timezone': 'America/Chicago' } }));
    expect(res.status).toBe(200);
    expect(h.warmed).toEqual([]); // not before the response
    for (const t of h.tasks.splice(0)) await t();
    expect(h.warmed).toEqual([['user-1', 'America/Chicago']]);
  });
});

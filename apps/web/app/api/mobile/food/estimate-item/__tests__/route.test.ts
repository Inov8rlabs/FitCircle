import { describe, expect, it, vi } from 'vitest';

const state = { error: null as Error | null };

// AI consent gate: allow-all here; the rule itself is tested in consent-service / ai-consent-routes tests.
vi.mock('@/lib/services/consent-service', async (orig) => (await import('@/lib/services/__tests__/consent-stub')).allowAllConsentModule(orig));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: async () => ({ id: 'user-1' }) }));
vi.mock('@/lib/services/usage-service', () => {
  class UpgradeRequiredError extends Error {
    constructor(
      public readonly feature: string,
      public readonly used: number,
      public readonly limit: number,
      public readonly trialEligible?: boolean
    ) {
      super('UPGRADE_REQUIRED');
    }
  }
  return { UpgradeRequiredError };
});
vi.mock('@/lib/services/nutrition-intelligence-service', () => ({
  NutritionIntelligenceService: {
    estimateItem: async () => {
      if (state.error) throw state.error;
      return { name: 'Rice', calories: 130 };
    },
  },
}));

import { UpgradeRequiredError } from '@/lib/services/usage-service';

import { POST } from '../route';

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/mobile/food/estimate-item', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as any);

describe('POST /api/mobile/food/estimate-item — food AI allowance (TRIAL_FIRST_SPEC §5)', () => {
  it('blocked: 429 UPGRADE_REQUIRED keeps {feature, used, limit} and adds the paywall', async () => {
    state.error = new UpgradeRequiredError('food_ai_unlimited', 5, 5, true);
    const res = await post({ name: 'Rice', grams: 100 });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatchObject({
      code: 'UPGRADE_REQUIRED',
      message: "You've used your 5 free AI food analyses. Start your free 3-day trial to keep logging with AI.",
      details: { feature: 'food_ai_unlimited', used: 5, limit: 5, paywall: { trigger: 'food_ai', trialDays: 3, trialEligible: true } },
    });
  });

  it('allowed: unchanged success envelope', async () => {
    state.error = null;
    const res = await post({ name: 'Rice', grams: 100 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ name: 'Rice' });
  });
});

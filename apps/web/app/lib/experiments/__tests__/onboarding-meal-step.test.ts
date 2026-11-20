import { describe, expect, it } from 'vitest';

import { createExperimentSchema } from '../model';
import { ONBOARDING_MEAL_STEP_EXPERIMENT } from '../onboarding-meal-step';
import { RATE_METRICS } from '../results';

describe('onboarding_meal_step definition (ENGAGEMENT_115_SPEC §14.8)', () => {
  it('is a valid create body: 50/50, new users, 1.1.5+, iOS + Android, control fallback, no layer', () => {
    const parsed = createExperimentSchema.parse(ONBOARDING_MEAL_STEP_EXPERIMENT);
    expect(parsed.arms.map((a) => [a.key, a.weight, a.payload])).toEqual([
      ['control', 50, {}],
      ['variantA', 50, { meal_step: 'example_describe' }],
    ]);
    expect(parsed.audience).toEqual({ platforms: ['ios', 'android'], minAppVersion: '1.1.5', newUsersOnly: true });
    expect(parsed.fallbackArm).toBe('control');
    expect(parsed.layer ?? null).toBeNull();
  });
  it('its primary metric exists on the scorecard', () => {
    expect(RATE_METRICS.some((m) => m.key === 'first_meal_24h_after_onboarding')).toBe(true);
  });
});

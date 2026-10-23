import { describe, expect, it } from 'vitest';

import { FeatureFlagService } from '../feature-flag-service';

const U = '11111111-1111-4111-8111-111111111111';

describe('FeatureFlagService.evaluate', () => {
  it('disabled / missing flag / unknown profile → off', () => {
    expect(FeatureFlagService.evaluate(null, U, 'free').enabled).toBe(false);
    expect(FeatureFlagService.evaluate({ is_enabled: false, rollout_percentage: 100 }, U, 'free').enabled).toBe(false);
    expect(FeatureFlagService.evaluate({ is_enabled: true, rollout_percentage: 100 }, U, undefined).enabled).toBe(false);
  });

  it('allowlist, tier, rollout', () => {
    expect(FeatureFlagService.evaluate({ is_enabled: true, allowed_user_ids: [U] }, U, 'free')).toMatchObject({ enabled: true, reason: 'explicit' });
    expect(FeatureFlagService.evaluate({ is_enabled: true, allowed_tiers: ['premium'] }, U, 'premium')).toMatchObject({ enabled: true, reason: 'tier' });
    expect(FeatureFlagService.evaluate({ is_enabled: true, allowed_tiers: ['premium'] }, U, 'free').enabled).toBe(false);
    expect(FeatureFlagService.evaluate({ is_enabled: true, rollout_percentage: 100 }, U, null)).toMatchObject({ enabled: true, reason: 'rollout' });
    expect(FeatureFlagService.evaluate({ is_enabled: true, rollout_percentage: 0 }, U, null).enabled).toBe(false);
  });
});

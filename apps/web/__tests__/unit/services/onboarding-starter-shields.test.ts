/**
 * Starter streak shields are granted when onboarding completes (docs/STREAKS-SPEC.md):
 * once, idempotently, and never retroactively for users who finished long ago.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { AssessmentService } from '@/lib/services/assessment-service';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: { onActivity: vi.fn(async () => undefined) } }));

const USER = 'user-1';
let db: FakeSupabase;

const shieldTotal = () => db.getRows('streak_shields').reduce((sum, r) => sum + r.available_count, 0);

function seedProfile(extra: Record<string, unknown> = {}) {
  db.seed('profiles', [
    { id: USER, subscription_tier: 'free', total_xp: 0, current_level: 1, onboarding_completed: false, display_name: 'A', persona: null, ...extra },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
  resetRemoteConfigCache();
});

describe('AssessmentService.completeOnboarding (POST /api/mobile/onboarding/complete)', () => {
  it('grants the 2 starter shields on completion', async () => {
    seedProfile();
    const result = await AssessmentService.completeOnboarding(USER);
    expect(result.xpAwarded).toBe(250);
    expect(shieldTotal()).toBe(2);
    const freeze = db.getRows('streak_shields').find(r => r.shield_type === 'freeze')!;
    expect(freeze.metadata.starter_grant.reason).toBe('onboarding_starter');
  });

  it('a retry / replay right after completion never double-grants', async () => {
    seedProfile();
    await AssessmentService.completeOnboarding(USER);
    await AssessmentService.completeOnboarding(USER);
    await AssessmentService.completeOnboarding(USER);
    expect(shieldTotal()).toBe(2);
  });

  it('a retry after a failed grant still settles it (completed within 24h, no grant yet)', async () => {
    seedProfile({ onboarding_completed: true, onboarding_completed_at: new Date(Date.now() - 60_000).toISOString() });
    db.seed('streak_shields', [
      { user_id: USER, shield_type: 'freeze', available_count: 1 },
      { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
      { user_id: USER, shield_type: 'purchased', available_count: 0 },
    ]);
    await AssessmentService.completeOnboarding(USER);
    expect(shieldTotal()).toBe(2); // topped up to 2, not 1 + 2
  });

  it('no retroactive grant for a user who completed onboarding long ago', async () => {
    seedProfile({ onboarding_completed: true, onboarding_completed_at: '2026-01-01T00:00:00Z' });
    db.seed('streak_shields', [
      { user_id: USER, shield_type: 'freeze', available_count: 0 },
      { user_id: USER, shield_type: 'milestone_shield', available_count: 1 },
      { user_id: USER, shield_type: 'purchased', available_count: 0 },
    ]);
    await AssessmentService.completeOnboarding(USER);
    expect(shieldTotal()).toBe(1);
  });

  it('a failing shield grant never fails onboarding completion', async () => {
    seedProfile();
    const real = db.from.bind(db);
    vi.spyOn(db, 'from').mockImplementation((table: string) => {
      if (table === 'streak_shields') throw new Error('shields down');
      return real(table);
    });
    const result = await AssessmentService.completeOnboarding(USER);
    expect(result.success).toBe(true);
    expect(db.getRows('profiles')[0].onboarding_completed).toBe(true);
  });
});

describe('OnboardingService.completeOnboarding (POST /api/onboarding/complete)', () => {
  it('grants the starter shields once for a user completing now', async () => {
    seedProfile();
    await OnboardingService.completeOnboarding(USER);
    await OnboardingService.completeOnboarding(USER);
    expect(shieldTotal()).toBe(2);
  });

  it('no retroactive grant for a user who completed onboarding long ago', async () => {
    seedProfile({ onboarding_completed: true, onboarding_completed_at: '2026-01-01T00:00:00Z' });
    await OnboardingService.completeOnboarding(USER);
    expect(db.getRows('streak_shields')).toEqual([]);
  });
});

/** Server-side `Streak Shield Granted` events (tracking plan v35). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackServerEventInBackground } from '@/lib/analytics/amplitude-server';
import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { StreakShieldService } from '@/lib/services/streak-shield-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');
vi.mock('@/lib/analytics/amplitude-server', () => ({ trackServerEventInBackground: vi.fn() }));

const USER = 'user-1';
let db: FakeSupabase;

const events = () =>
  vi.mocked(trackServerEventInBackground).mock.calls.map(([e]) => ({ name: e.event_type, ...e.event_properties, insert_id: e.insert_id }));

function seedRows(freeze: number, milestone = 0) {
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: freeze },
    { user_id: USER, shield_type: 'milestone_shield', available_count: milestone },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
  resetRemoteConfigCache();
  db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
});

describe('Streak Shield Granted', () => {
  it('lazy_first_touch when the inventory is first created outside onboarding', async () => {
    await StreakShieldService.getInventory(USER);
    await StreakShieldService.getInventory(USER);
    expect(events()).toEqual([expect.objectContaining({ name: 'Streak Shield Granted', reason: 'lazy_first_touch', count: 2 })]);
  });

  it('onboarding_starter once, with a dedupe insert_id; a replay sends nothing', async () => {
    await StreakShieldService.grantOnboardingStarter(USER);
    await StreakShieldService.grantOnboardingStarter(USER);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ reason: 'onboarding_starter', count: 2 });
    expect(events()[0].insert_id).toMatch(/^shield-grant:starter:/);
  });

  it('onboarding_starter top-up reports only the shields added', async () => {
    seedRows(1);
    await StreakShieldService.grantOnboardingStarter(USER);
    expect(events()).toEqual([expect.objectContaining({ reason: 'onboarding_starter', count: 1 })]);
  });

  it('streak_earned with the banked count; nothing when capped out', async () => {
    seedRows(0);
    await StreakShieldService.earnForStreakIncrease(USER, 0, 14, '2026-08-14');
    expect(events()).toEqual([expect.objectContaining({ reason: 'streak_earned', count: 2 })]);
    vi.mocked(trackServerEventInBackground).mockClear();
    await StreakShieldService.earnForStreakIncrease(USER, 14, 28, '2026-08-28'); // 2 earned, 1 slot
    expect(events()).toEqual([expect.objectContaining({ reason: 'streak_earned', count: 1 })]);
    vi.mocked(trackServerEventInBackground).mockClear();
    await StreakShieldService.earnForStreakIncrease(USER, 28, 35, '2026-09-04'); // full
    expect(events()).toEqual([]);
  });

  it('purchased for a verified purchase credit', async () => {
    seedRows(1);
    await StreakShieldService.creditPurchased(USER, 1);
    expect(events()).toEqual([expect.objectContaining({ reason: 'purchased', count: 1 })]);
  });
});

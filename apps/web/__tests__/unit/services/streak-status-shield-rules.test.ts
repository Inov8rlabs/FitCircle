/** GET /api/mobile/streaks/status payload (camelCase) carries the resolved shield rules. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { getStreakStatus } from '@/lib/services/daily-checkin-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');

const USER = 'user-1';
let db: FakeSupabase;

beforeEach(() => {
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
  resetRemoteConfigCache();
  db.seed('profiles', [{ id: USER, subscription_tier: 'free' }]);
});

describe('getStreakStatus shieldRules', () => {
  it('new user: live starter balance and code-default rules', async () => {
    const status = await getStreakStatus(USER, db as any, 'UTC');
    expect(status.freezesAvailable).toBe(2);
    expect(status.shieldRules).toEqual({ earnIntervalDays: 7, starterCount: 2, maxBalance: 3 });
  });

  it('existing user: rules follow remote config', async () => {
    db.seed('engagement_streaks', [{ user_id: USER, current_streak: 0, longest_streak: 0, streak_freezes_available: 1, total_points: 0 }]);
    db.seed('remote_config_defaults', [
      { config_key: 'streak_shield_earn_interval_days', value: 14, updated_by: null, updated_at: '2026-11-13T00:00:00Z' },
    ]);
    const status = await getStreakStatus(USER, db as any, 'UTC');
    expect(status.shieldRules).toEqual({ earnIntervalDays: 14, starterCount: 2, maxBalance: 3 });
  });
});

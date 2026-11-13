import { describe, expect, it, vi } from 'vitest';

// audience.ts imports orchestrator types only; the admin client is never touched.
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { HABIT_TYPES, TRANSACTIONAL_AUDIENCE_TYPES, audienceSuppression, testAccountReason } from '../audience';
import { computeLifecycle, latestOf, stageForDays } from '../lifecycle';
import { inferTimezone, offsetBounds, offsetMinutes } from '../timezone-inference';

describe('lifecycle stage', () => {
  it('maps local days since last seen to stages', () => {
    expect([0, 1, 2].map(stageForDays)).toEqual(['active', 'active', 'active']);
    expect([3, 6].map(stageForDays)).toEqual(['lapsed_3', 'lapsed_3']);
    expect([7, 13].map(stageForDays)).toEqual(['lapsed_7', 'lapsed_7']);
    expect([14, 29].map(stageForDays)).toEqual(['lapsed_14', 'lapsed_14']);
    expect(stageForDays(30)).toBe('lapsed_30');
    expect([31, 400].map(stageForDays)).toEqual(['dormant', 'dormant']);
  });

  it('counts LOCAL calendar days, not 24h blocks (timezone boundaries)', () => {
    // Last seen 23:50 New York on Nov 10 (= 04:50Z Nov 11). Now 00:10 New York Nov 13.
    const seen = '2026-11-11T04:50:00Z';
    const now = new Date('2026-11-13T05:10:00Z');
    expect(computeLifecycle(seen, now, 'America/New_York')).toEqual({ stage: 'lapsed_3', daysSinceSeen: 3, lastSeenLocalDate: '2026-11-10' });
    // The same instants in Kolkata: seen Nov 11 10:20, now Nov 13 10:40 → 2 days → still active.
    expect(computeLifecycle(seen, now, 'Asia/Kolkata')).toMatchObject({ stage: 'active', daysSinceSeen: 2, lastSeenLocalDate: '2026-11-11' });
  });

  it('is null (unknown) without a signal, and clamps a future lastSeenAt to today', () => {
    expect(computeLifecycle(null, new Date(), 'UTC')).toBeNull();
    expect(computeLifecycle('not a date', new Date(), 'UTC')).toBeNull();
    const now = new Date('2026-11-13T12:00:00Z');
    expect(computeLifecycle('2026-11-14T12:00:00Z', now, 'UTC')?.stage).toBe('active');
  });

  it('latestOf picks the newest valid timestamp', () => {
    expect(latestOf([null, '2026-11-01T00:00:00Z', 'bad', '2026-11-05T00:00:00Z', undefined])).toBe('2026-11-05T00:00:00.000Z');
    expect(latestOf([null, undefined])).toBeNull();
  });
});

describe('audience rules', () => {
  const real = (stage: any) => ({ testReason: null, stage });

  it('test accounts get no non-transactional push; transactional types always pass', () => {
    const t = { testReason: 'play_testers' as const, stage: 'active' as const };
    expect(audienceSuppression('meal_reminder_lunch', t)).toBe('test_user');
    expect(audienceSuppression('winback_day3', t)).toBe('test_user');
    expect(audienceSuppression('leaderboard_overtaken', t)).toBe('test_user');
    expect(audienceSuppression('health_sync_update', t)).toBe('test_user');
    for (const type of TRANSACTIONAL_AUDIENCE_TYPES) expect(audienceSuppression(type, t)).toBeNull();
  });

  it('habit nudges only for active users', () => {
    for (const type of HABIT_TYPES) {
      expect(audienceSuppression(type, real('active'))).toBeNull();
      expect(audienceSuppression(type, real('lapsed_3'))).toBe('lapsed_user');
      expect(audienceSuppression(type, real('lapsed_30'))).toBe('lapsed_user');
      expect(audienceSuppression(type, real('dormant'))).toBe('dormant_user');
    }
    expect(audienceSuppression('momentum_at_risk', real(null))).toBeNull(); // unknown → fail open
  });

  it('dormant users: transactional + health sync only', () => {
    expect(audienceSuppression('chat_message', real('dormant'))).toBeNull();
    expect(audienceSuppression('trial_ending_reminder', real('dormant'))).toBeNull();
    expect(audienceSuppression('health_sync_update', real('dormant'))).toBeNull();
    expect(audienceSuppression('circle_streak_milestone', real('dormant'))).toBe('dormant_user');
    expect(audienceSuppression('leaderboard_overtaken', real('dormant'))).toBe('dormant_user');
    expect(audienceSuppression('winback_day30', real('dormant'))).toBe('dormant_user');
  });

  it('win-back only while lapsed; overtake for active + lapsed', () => {
    expect(audienceSuppression('winback_day7', real('lapsed_7'))).toBeNull();
    expect(audienceSuppression('winback_day7', real('active'))).toBe('not_lapsed');
    expect(audienceSuppression('leaderboard_overtaken', real('active'))).toBeNull();
    expect(audienceSuppression('leaderboard_overtaken', real('lapsed_14'))).toBeNull();
    // Non-habit social/circle pushes still reach lapsed users.
    expect(audienceSuppression('circle_streak_milestone', real('lapsed_7'))).toBeNull();
  });

  it('testAccountReason = Ads Console rules + profiles.metadata.test_device', () => {
    const env = {};
    expect(testAccountReason({ email: 'ani@fitcircle.ai' }, env)).toBe('internal');
    expect(testAccountReason({ email: 'x@gmail.com', isAdmin: true }, env)).toBe('internal');
    expect(testAccountReason({ email: 'jamiesmith.12345@gmail.com' }, env)).toBe('play_testers');
    expect(testAccountReason({ email: 'a@cloudtestlabaccounts.com' }, env)).toBe('test_lab');
    expect(testAccountReason({ email: 'real.person@gmail.com', mockAttribution: true }, env)).toBe('mock_attribution');
    expect(testAccountReason({ email: 'real.person@gmail.com', metadata: { test_device: { at: 'x' } } }, env)).toBe('test_device');
    expect(testAccountReason({ email: 'real.person@gmail.com', metadata: {} }, env)).toBeNull();
  });
});

describe('timezone inference (placeholder backfill)', () => {
  const candidates = ['America/Chicago', 'America/New_York', 'Asia/Kolkata', 'America/Los_Angeles'];

  it('prefers the zone the device sent with a streak claim', () => {
    expect(inferTimezone({ claimTimezones: [{ timezone: 'UTC', at: '2026-11-10T00:00:00Z' }, { timezone: 'Asia/Kolkata', at: '2026-11-01T00:00:00Z' }], opens: [] }, candidates)).toEqual({
      timezone: 'Asia/Kolkata',
      source: 'streak_claim',
      exact: true,
    });
  });

  it('uses an app_opens zone unless it is the server fallback (New York)', () => {
    expect(inferTimezone({ claimTimezones: [], opens: [{ local_date: '2026-11-10', first_open_at: '2026-11-10T15:00:00Z', timezone: 'America/Chicago' }] }, candidates)).toMatchObject({ timezone: 'America/Chicago', exact: true });
    // New York here is just the fallback: falls through to offset inference (one open → ambiguous → null).
    expect(inferTimezone({ claimTimezones: [], opens: [{ local_date: '2026-11-10', first_open_at: '2026-11-10T15:00:00Z', timezone: 'America/New_York' }] }, candidates)).toBeNull();
  });

  it('pins an offset from opens on both sides of UTC midnight', () => {
    // Opens at 23:30 local on Nov 10 and 00:30 local on Nov 11 in Kolkata (+05:30).
    const opens = [
      { local_date: '2026-11-10', first_open_at: '2026-11-10T18:00:00Z', timezone: 'America/New_York' },
      { local_date: '2026-11-11', first_open_at: '2026-11-10T19:00:00Z', timezone: 'America/New_York' },
    ];
    expect(offsetBounds(opens)).toEqual({ min: 300, max: 359 });
    expect(inferTimezone({ claimTimezones: [], opens }, candidates, new Date('2026-11-12T00:00:00Z'))).toMatchObject({ timezone: 'Asia/Kolkata', source: 'open_offset', exact: false, offsetMinutes: 330 });
  });

  it('offsetMinutes', () => {
    expect(offsetMinutes('Asia/Kolkata', new Date('2026-11-12T00:00:00Z'))).toBe(330);
    expect(offsetMinutes('America/New_York', new Date('2026-11-12T00:00:00Z'))).toBe(-300);
  });
});

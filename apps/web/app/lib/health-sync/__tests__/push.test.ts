import { describe, expect, it } from 'vitest';

import { activityName, healthSyncSkip, stepGoalUpdate, workoutUpdate } from '../push';

const today = '2026-11-13';
const now = new Date('2026-11-13T20:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe('health sync update copy', () => {
  it('workout: the longest new workout today, and the streak when it claimed today', () => {
    const u = workoutUpdate({
      workouts: [
        { exerciseType: 'walking', minutes: 12, date: today },
        { exerciseType: 'running', minutes: 32, date: today },
        { exerciseType: 'cycling', minutes: 90, date: '2026-11-12' }, // not today
      ],
      today,
      platform: 'android',
      claimedToday: true,
      streakCount: 5,
    });
    expect(u).toMatchObject({
      kind: 'workout',
      title: 'Your 32-min run synced from Health Connect',
      body: 'That counts for today: your streak is 5 days. Tap to see your week.',
      screen: 'exercise_log',
    });
    expect(workoutUpdate({ workouts: [{ exerciseType: 'yoga', minutes: 20, date: today }], today, platform: 'ios', claimedToday: false })!.title).toBe('Your 20-min yoga session synced from Apple Health');
    expect(workoutUpdate({ workouts: [{ exerciseType: 'yoga', minutes: 20, date: today }], today, platform: 'ios', claimedToday: false })!.body).not.toContain('streak');
  });

  it('workout: nothing for short or past workouts', () => {
    expect(workoutUpdate({ workouts: [{ exerciseType: 'walking', minutes: 9, date: today }], today, platform: 'android', claimedToday: false })).toBeNull();
    expect(workoutUpdate({ workouts: [{ exerciseType: 'walking', minutes: 40, date: '2026-11-11' }], today, platform: 'android', claimedToday: false })).toBeNull();
    expect(activityName('somethingNew')).toBe('workout');
  });

  it('step goal: only today and only when reached', () => {
    expect(stepGoalUpdate({ steps: 10_412, goal: 10_000, date: today, today, platform: 'android' })).toMatchObject({
      kind: 'step_goal',
      title: 'You hit your 10,000-step goal',
      body: '10,412 steps today, synced from Health Connect. Tap to see your day.',
    });
    expect(stepGoalUpdate({ steps: 9_999, goal: 10_000, date: today, today, platform: 'android' })).toBeNull();
    expect(stepGoalUpdate({ steps: 12_000, goal: 10_000, date: '2026-11-12', today, platform: 'android' })).toBeNull();
    expect(stepGoalUpdate({ steps: 12_000, goal: null, date: today, today, platform: 'android' })).toBeNull();
  });
});

describe('health sync update rules', () => {
  const base = { testUser: false, stage: 'lapsed_7', lastSeenAt: hoursAgo(72), now, lastHealthSyncAt: null, lastWinbackAt: null };
  it('sends to lapsed and dormant users who are not in the app', () => {
    expect(healthSyncSkip(base)).toBeNull();
    expect(healthSyncSkip({ ...base, stage: 'dormant', lastSeenAt: hoursAgo(24 * 60) })).toBeNull();
  });
  it('skips recent foreground use, test users, dormant spacing and a win-back today', () => {
    expect(healthSyncSkip({ ...base, lastSeenAt: hoursAgo(2) })).toBe('recently_open');
    expect(healthSyncSkip({ ...base, testUser: true })).toBe('test_user');
    expect(healthSyncSkip({ ...base, stage: 'dormant', lastHealthSyncAt: hoursAgo(48) })).toBe('dormant_spacing');
    expect(healthSyncSkip({ ...base, stage: 'dormant', lastHealthSyncAt: hoursAgo(80) })).toBeNull();
    expect(healthSyncSkip({ ...base, lastWinbackAt: hoursAgo(5) })).toBe('winback_today');
  });
});

describe('synced_while_away home card (promo@1)', () => {
  it('matches only with an unopened health-sync push and repeats its facts', async () => {
    const { syncedWhileAway } = await import('../../promos/system-promos');
    const { sampleMatchInput } = await import('../../promos/style-config');
    const base = sampleMatchInput(now);
    expect(syncedWhileAway.audience({ ...base, journey: { ...base.journey, healthSyncAway: null } })).toBe('nothing_synced');
    const input = { ...base, journey: { ...base.journey, healthSyncAway: { title: 'You hit your 10,000-step goal', body: '10,412 steps today, synced from Health Connect. Tap to see your day.', kind: 'step_goal' } } };
    expect(syncedWhileAway.audience(input)).toBeNull();
    const [c] = syncedWhileAway.creatives(input);
    expect(c).toMatchObject({ eyebrow: 'Synced while you were away', title: 'You hit your 10,000-step goal', body: '10,412 steps today, synced from Health Connect.', layout: 'banner' });
    expect(c.primary.action).toMatchObject({ type: 'open_screen', params: { screen: 'step_history' } });
  });
});

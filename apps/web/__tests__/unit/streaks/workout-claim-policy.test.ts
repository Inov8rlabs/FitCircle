import { describe, it, expect } from 'vitest';
import { workoutCountsForStreak, WORKOUT_CHECKIN_MINUTES } from '@/lib/streaks/workout-claim-policy';

describe('workoutCountsForStreak', () => {
  it('any manual workout counts, however short', () => {
    expect(workoutCountsForStreak(1, 'manual')).toBe(true);
    expect(workoutCountsForStreak(5)).toBe(true);
  });

  it('a synced workout counts once it reaches the check-in threshold', () => {
    expect(workoutCountsForStreak(WORKOUT_CHECKIN_MINUTES, 'healthkit')).toBe(true);
    expect(workoutCountsForStreak(58, 'healthkit')).toBe(true);
  });

  it('a synced workout under the threshold does not count', () => {
    expect(workoutCountsForStreak(WORKOUT_CHECKIN_MINUTES - 1, 'healthkit')).toBe(false);
    expect(workoutCountsForStreak(0, 'healthkit')).toBe(false);
  });
});

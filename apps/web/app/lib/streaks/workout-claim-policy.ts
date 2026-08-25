/**
 * Which workouts count as "showing up" for the daily streak.
 *
 * Product rule (revised 2026-08-25): a real workout is real effort whether
 * the user typed it in or their watch recorded it. A synced HealthKit /
 * Health Connect session of at least WORKOUT_CHECKIN_MINUTES claims the day
 * exactly like a manual log does. Passive metrics (steps, weight, mood)
 * still never claim — they can arrive with the phone in a drawer.
 *
 * This replaces "manual = auto-claim, HealthKit = tap Claim" (exercise PRD
 * decision #4), which meant an Apple Watch user who did an hour of HIIT and
 * never opened the app lost their streak.
 *
 * The threshold matches `counts_as_checkin` on exercise_logs so streaks,
 * momentum and circle boosts all agree on what a workout is.
 */

export const WORKOUT_CHECKIN_MINUTES = 10;

export type WorkoutSource = 'manual' | 'healthkit' | string;

/** True when a workout should auto-claim its streak day. */
export function workoutCountsForStreak(durationMinutes: number, source: WorkoutSource = 'manual'): boolean {
  if (source === 'manual') return true;
  return durationMinutes >= WORKOUT_CHECKIN_MINUTES;
}

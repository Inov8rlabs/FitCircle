/**
 * "Health sync update" push + home card copy (docs/PUSH_NOTIFICATIONS.md §8.5). PURE.
 *
 * When a background Health Connect / HealthKit sync brings something worth
 * opening the app for, the server tells the user. Two update kinds, both from
 * data the sync just wrote — nothing estimated:
 *   - workout     a NEW synced workout dated today (≥ MIN_WORKOUT_MINUTES), the
 *                 longest one; says so when it claimed today's streak
 *                 (workout-claim-policy, server-side).
 *   - step_goal   today's synced steps reached the user's daily step goal
 *                 (profiles.goals → targetsView; the goal the app shows them).
 * Weight was considered and left out: the weight route is also the manual
 * entry path, so "synced" could not be stated truthfully.
 */
export type HealthSyncKind = 'workout' | 'step_goal';

export const MIN_WORKOUT_MINUTES = 10;

export interface SyncedWorkout {
  exerciseType: string;
  minutes: number;
  /** Local date the workout counts on (YYYY-MM-DD). */
  date: string;
}

export interface HealthSyncUpdate {
  kind: HealthSyncKind;
  title: string;
  body: string;
  /** Push screen: exercise_log for a workout, dashboard for steps. */
  screen: 'exercise_log' | 'dashboard';
  /** Facts kept in notification_log.data (and the home card). */
  facts: Record<string, string | number | boolean>;
}

const ACTIVITY_NAMES: Record<string, string> = {
  walking: 'walk',
  running: 'run',
  cycling: 'ride',
  hiking: 'hike',
  swimming: 'swim',
  yoga: 'yoga session',
  pilates: 'Pilates session',
  hiit: 'HIIT workout',
  strengthtraining: 'strength workout',
  strength_training: 'strength workout',
  functionaltraining: 'strength workout',
  stairclimbing: 'stair climb',
  elliptical: 'elliptical session',
  cardiodance: 'dance workout',
  crosstraining: 'cross-training session',
  tennis: 'tennis session',
  basketball: 'basketball session',
};

/** "run", "strength workout", … ; unknown types are just "workout". */
export function activityName(exerciseType: string): string {
  return ACTIVITY_NAMES[String(exerciseType ?? '').toLowerCase()] ?? 'workout';
}

/** Where the data came from, as the user knows it. */
export function sourceName(platform: string | null | undefined): string | null {
  if (platform === 'android') return 'Health Connect';
  if (platform === 'ios') return 'Apple Health';
  return null;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function workoutUpdate(input: {
  workouts: readonly SyncedWorkout[];
  today: string;
  platform: string | null | undefined;
  /** The sync claimed today's streak (AutoClaimResult.claimed && day === today). */
  claimedToday: boolean;
  streakCount?: number | null;
}): HealthSyncUpdate | null {
  const todays = input.workouts.filter((w) => w.date === input.today && Number.isFinite(w.minutes) && w.minutes >= MIN_WORKOUT_MINUTES);
  if (todays.length === 0) return null;
  const best = [...todays].sort((a, b) => b.minutes - a.minutes)[0];
  const minutes = Math.round(best.minutes);
  const src = sourceName(input.platform);
  const title = `Your ${minutes}-min ${activityName(best.exerciseType)} synced${src ? ` from ${src}` : ''}`;
  const streak = typeof input.streakCount === 'number' && input.streakCount > 0 ? input.streakCount : null;
  const body = input.claimedToday
    ? streak && streak > 1
      ? `That counts for today: your streak is ${streak} days. Tap to see your week.`
      : "That counts toward today's streak. Tap to see your week."
    : 'Tap to see it with the rest of your week.';
  return {
    kind: 'workout',
    title,
    body,
    screen: 'exercise_log',
    facts: { kind: 'workout', minutes, activity: activityName(best.exerciseType), claimedToday: input.claimedToday, date: best.date },
  };
}

export function stepGoalUpdate(input: { steps: number | null | undefined; goal: number | null | undefined; date: string; today: string; platform: string | null | undefined }): HealthSyncUpdate | null {
  const steps = Number(input.steps);
  const goal = Number(input.goal);
  if (input.date !== input.today || !Number.isFinite(steps) || !Number.isFinite(goal) || goal <= 0 || steps < goal) return null;
  const src = sourceName(input.platform);
  return {
    kind: 'step_goal',
    title: `You hit your ${fmt(goal)}-step goal`,
    body: `${fmt(steps)} steps today${src ? `, synced from ${src}` : ''}. Tap to see your day.`,
    screen: 'dashboard',
    facts: { kind: 'step_goal', steps: Math.round(steps), goal: Math.round(goal), date: input.date },
  };
}

export const FOREGROUND_RECENT_HOURS = 3;
export const DORMANT_MIN_SPACING_HOURS = 72;

export type HealthSyncSkip = 'test_user' | 'recently_open' | 'dormant_spacing' | 'winback_today' | 'nothing_new';

/** Should this update go out? Pure; history comes from notification_log. */
export function healthSyncSkip(input: {
  testUser: boolean;
  stage: string | null;
  lastSeenAt: string | null;
  now: Date;
  lastHealthSyncAt: string | null;
  lastWinbackAt: string | null;
}): HealthSyncSkip | null {
  if (input.testUser) return 'test_user';
  const ago = (iso: string | null) => (iso ? (input.now.getTime() - Date.parse(iso)) / 3_600_000 : Infinity);
  if (ago(input.lastSeenAt) < FOREGROUND_RECENT_HOURS) return 'recently_open';
  if (input.stage === 'dormant' && ago(input.lastHealthSyncAt) < DORMANT_MIN_SPACING_HOURS) return 'dormant_spacing';
  // For lapsed users it REPLACES the day's win-back step: never on top of one.
  if (ago(input.lastWinbackAt) < 20) return 'winback_today';
  return null;
}

export function healthSyncDedupeKey(kind: HealthSyncKind, date: string): string {
  return `health_sync:${kind}:${date}`;
}

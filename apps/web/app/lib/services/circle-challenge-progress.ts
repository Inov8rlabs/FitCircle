/**
 * Pure progress math for circle challenges (no I/O, fully unit-tested).
 *
 * A participant's stored progress fields (`cumulative_total`, `today_total`,
 * `log_count`, `goal_completion_pct`, streaks, `last_logged_at`) are always derived
 * from the participant's log rows by `computeProgress`, both after a log is added
 * and after one is deleted. Deriving instead of incrementing keeps the leaderboard
 * consistent with the logs even after a concurrent write or a failed request.
 *
 * "Today" is a UTC calendar day everywhere in the challenge feature: it matches the
 * database default of `challenge_logs.log_date` (CURRENT_DATE) and the leaderboard.
 */
import {
  MAX_LOG_AMOUNT,
  MAX_LOG_NOTE_LENGTH,
  MILESTONES,
  STREAK_GRACE_HOURS,
  type MilestoneThreshold,
} from '../types/circle-challenge';

/** The smallest amount `challenge_logs.amount numeric(12,2)` can hold above zero. */
export const MIN_STORABLE_LOG_AMOUNT = 0.01;

/** Categories the shipped iOS `ChallengeCategory` enum can decode. */
export const CLIENT_CHALLENGE_CATEGORIES = ['strength', 'cardio', 'flexibility', 'wellness', 'custom'] as const;
export type ClientChallengeCategory = (typeof CLIENT_CHALLENGE_CATEGORIES)[number];

export interface ProgressLogRow {
  amount: number | string;
  log_date: string;
  logged_at: string;
}

export interface ParticipantProgress {
  cumulative_total: number;
  today_total: number;
  log_count: number;
  goal_completion_pct: number;
  current_streak: number;
  longest_streak: number;
  last_logged_at: string | null;
}

/** UTC calendar day (`YYYY-MM-DD`) of an instant. */
export function utcDay(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** PostgREST returns `numeric` as a JSON number, but tolerate a string. */
export function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The amount as it will be stored (2 decimals), or null when it is outside
 * 0.01 … MAX_LOG_AMOUNT. Rounding first means 0.004 is rejected here instead of
 * failing the table's `amount > 0` CHECK.
 */
export function normalizeLogAmount(amount: unknown): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const rounded = round2(amount);
  if (rounded < MIN_STORABLE_LOG_AMOUNT || rounded > MAX_LOG_AMOUNT) return null;
  return rounded;
}

/** Trimmed note cut to the column limit; empty becomes null. */
export function normalizeLogNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim().slice(0, MAX_LOG_NOTE_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Percentage 0 … 100 with 2 decimals (the column is numeric(5,2)). */
export function completionPct(cumulativeTotal: number, goalAmount: number): number {
  const goal = toNumber(goalAmount);
  if (goal <= 0) return 0;
  const pct = (toNumber(cumulativeTotal) / goal) * 100;
  return round2(Math.min(Math.max(pct, 0), 100));
}

/**
 * Derive every stored progress field from the participant's logs.
 *
 * Streak rule (unchanged from the incremental version): the first log starts a
 * streak of 1; the first log of a later day extends it when it comes within
 * STREAK_GRACE_HOURS of the previous log, otherwise the streak restarts at 1;
 * further logs on the same day do not change it.
 */
export function computeProgress(
  logs: ProgressLogRow[],
  goalAmount: number,
  today: string = utcDay()
): ParticipantProgress {
  const ordered = [...logs].sort(
    (a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime()
  );

  let cumulative = 0;
  let todayTotal = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let previousDay: string | null = null;
  let previousAt: number | null = null;

  for (const log of ordered) {
    const amount = toNumber(log.amount);
    cumulative += amount;
    if (log.log_date === today) todayTotal += amount;

    const at = new Date(log.logged_at).getTime();
    if (previousAt === null) {
      currentStreak = 1;
    } else if (log.log_date !== previousDay) {
      const hours = (at - previousAt) / (1000 * 60 * 60);
      currentStreak = hours <= STREAK_GRACE_HOURS ? currentStreak + 1 : 1;
    }
    longestStreak = Math.max(longestStreak, currentStreak);
    previousDay = log.log_date;
    previousAt = at;
  }

  const cumulativeTotal = round2(cumulative);
  return {
    cumulative_total: cumulativeTotal,
    today_total: round2(todayTotal),
    log_count: ordered.length,
    goal_completion_pct: completionPct(cumulativeTotal, goalAmount),
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_logged_at: ordered.length > 0 ? ordered[ordered.length - 1].logged_at : null,
  };
}

/**
 * Milestone flags after progress moved from `oldPct` to `newPct`.
 *
 * - Every threshold at or below `newPct` is flagged (a single log can cross several).
 * - Flags above `newPct` are cleared, so a milestone that was only reached through a
 *   since-deleted log can be earned, and celebrated, again.
 * - `reached` is the HIGHEST threshold newly crossed by this change, or null.
 */
export function reconcileMilestones(
  previous: Record<string, boolean> | null | undefined,
  oldPct: number,
  newPct: number
): { milestones: Record<string, boolean>; reached: MilestoneThreshold | null } {
  const milestones: Record<string, boolean> = { ...(previous ?? {}) };
  let reached: MilestoneThreshold | null = null;

  for (const threshold of MILESTONES) {
    const key = `milestone_${threshold}`;
    if (newPct >= threshold) {
      if (!milestones[key] && oldPct < threshold) reached = threshold;
      milestones[key] = true;
    } else {
      delete milestones[key];
    }
  }

  return { milestones, reached };
}

/**
 * The category as old clients can decode it. The shipped iOS build decodes
 * `category` with a strict enum, and one unknown value fails the WHOLE challenge
 * list, so anything outside the five known values is presented as `custom`.
 * The stored value is untouched and is returned separately as `category_raw`.
 */
export function presentCategory(stored: unknown): ClientChallengeCategory {
  return (CLIENT_CHALLENGE_CATEGORIES as readonly string[]).includes(stored as string)
    ? (stored as ClientChallengeCategory)
    : 'custom';
}

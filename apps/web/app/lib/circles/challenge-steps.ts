/**
 * Steps challenges fed by synced steps — the pure part (no I/O).
 *
 * A circle challenge whose unit is "steps" used to count only manual
 * challenge_logs, so "8,000 Steps Daily" sat at 0 / 168,000 while members synced
 * thousands of steps from HealthKit / Health Connect into daily_tracking. Here a
 * participant's amount for a day is
 *
 *     max(synced daily_tracking steps that day, sum of manual logs that day)
 *
 * over the challenge's days in the MEMBER'S local calendar (profiles.timezone):
 * from the local day starts_at falls on through the local day just before ends_at.
 * The result feeds the same stored participant fields (cumulative_total,
 * today_total, goal_completion_pct, streaks, …) the shipped apps already render.
 *
 * Manual-log challenges (any other unit) are untouched and keep their UTC-day rules
 * in circle-challenge-progress.ts.
 */
import { completionPct, round2, toNumber, type ParticipantProgress } from '@/lib/services/circle-challenge-progress';

import { addDays, challengeDailyStepGoal } from './steps-leaderboard';

export function isStepsChallenge(challenge: { unit?: string | null } | null | undefined): boolean {
  return (challenge?.unit ?? '').trim().toLowerCase() === 'steps';
}

/** YYYY-MM-DD of an instant in a timezone. */
export function localDay(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Offset (ms) of a timezone from UTC at an instant: local wall clock minus UTC. */
function offsetAt(instantMs: number, timezone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - Math.floor(instantMs / 1000) * 1000;
}

/** The UTC instant of local midnight starting `day` in `timezone` (DST-safe). */
export function localMidnight(day: string, timezone: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`);
  let instant = guess - offsetAt(guess, timezone);
  instant = guess - offsetAt(instant, timezone);
  return new Date(instant);
}

/**
 * starts_at / ends_at snapped to local midnight. A challenge runs on whole days:
 * the start becomes the midnight opening its local day; the end becomes the
 * midnight opening the local day it falls on (exclusive, like fitcircles.end_date),
 * and at least one day after the start.
 */
export function snapChallengeWindow(startsAt: string, endsAt: string, timezone: string): { starts_at: string; ends_at: string } {
  const startDay = localDay(new Date(startsAt), timezone);
  let endDay = localDay(new Date(endsAt), timezone);
  if (endDay <= startDay) endDay = addDays(startDay, 1);
  return {
    starts_at: localMidnight(startDay, timezone).toISOString(),
    ends_at: localMidnight(endDay, timezone).toISOString(),
  };
}

/** First and last (inclusive) local day of a challenge for a member. */
export function challengeDays(startsAt: string, endsAt: string, timezone: string): { first: string; last: string } {
  const first = localDay(new Date(startsAt), timezone);
  // ends_at is exclusive: the last day is the one holding the instant just before it.
  let last = localDay(new Date(Date.parse(endsAt) - 1), timezone);
  if (last < first) last = first;
  return { first, last };
}

export interface StepsProgressInput {
  /** date -> synced steps (daily_tracking.steps). */
  synced: Map<string, number>;
  /** Manual challenge_logs (log_date is the day they count for). */
  logs: Array<{ amount: number | string; log_date: string; logged_at: string }>;
  goalAmount: number;
  /** Daily step goal for streaks, or null (then any steps on a day keep the streak). */
  dailyGoal: number | null;
  first: string;
  last: string;
  /** The member's local today. */
  today: string;
  /** Newest steps_synced_at among the synced rows. */
  lastSyncedAt: string | null;
}

/** Per-day amounts and every stored progress field for a steps challenge. */
export function computeStepsProgress(input: StepsProgressInput): ParticipantProgress & { days: Array<{ date: string; amount: number }> } {
  const manual = new Map<string, number>();
  for (const log of input.logs) manual.set(log.log_date, (manual.get(log.log_date) ?? 0) + toNumber(log.amount));

  const through = input.today < input.last ? input.today : input.last;
  const days: Array<{ date: string; amount: number }> = [];
  for (let d = input.first; d <= through; d = addDays(d, 1)) {
    days.push({ date: d, amount: round2(Math.max(input.synced.get(d) ?? 0, manual.get(d) ?? 0)) });
  }

  const hit = (amount: number) => (input.dailyGoal ? amount >= input.dailyGoal : amount > 0);
  let run = 0;
  let longest = 0;
  for (const day of days) {
    run = hit(day.amount) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today still counts as "in progress": a streak through yesterday stays alive.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (hit(days[i].amount)) current += 1;
    else if (!(i === days.length - 1 && days[i].date === input.today)) break;
  }

  const cumulative = round2(days.reduce((sum, d) => sum + d.amount, 0));
  const todayAmount = days.find((d) => d.date === input.today)?.amount ?? 0;
  const lastLog = input.logs.reduce<string | null>((max, l) => (!max || l.logged_at > max ? l.logged_at : max), null);
  const lastActivity = [lastLog, days.some((d) => d.amount > 0) ? input.lastSyncedAt : null]
    .filter((v): v is string => !!v)
    .sort()
    .pop() ?? null;

  return {
    cumulative_total: cumulative,
    today_total: todayAmount,
    log_count: days.filter((d) => d.amount > 0).length,
    goal_completion_pct: completionPct(cumulative, input.goalAmount),
    current_streak: current,
    longest_streak: longest,
    last_logged_at: lastActivity,
    days,
  };
}

export { challengeDailyStepGoal };

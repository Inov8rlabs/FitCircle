/**
 * Free allowances for release 1.1.5 (docs/ENGAGEMENT_115_SPEC.md §2, §3): the pure part.
 *
 *  - Food scans: a lifetime starter allowance (free_food_ai_analyses_total), then a daily
 *    allowance per LOCAL day (free_food_ai_daily_after_total, 0 = none → `exhausted`).
 *  - Fitzy: a weekly allowance per LOCAL week starting Monday 00:00
 *    (free_fitzy_messages_per_week); 0 = the old daily key applies.
 *
 * No I/O here: UsageService does the counting and feeds these functions.
 */
import { localDay, localMidnight } from '@/lib/circles/challenge-steps';
import { addDays } from '@/lib/circles/steps-leaderboard';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';

export const DEFAULT_ALLOWANCE_TIMEZONE = 'America/New_York';

/** Request zone → profile zone → America/New_York. */
export function allowanceTimezone(requestTz: string | null | undefined, profileTz: string | null | undefined): string {
  if (isValidTimezone(requestTz)) return requestTz;
  if (isValidTimezone(profileTz)) return profileTz;
  return DEFAULT_ALLOWANCE_TIMEZONE;
}

/** The local day holding `now`: its start (local midnight, UTC instant) and the next local midnight. */
export function localDayWindow(timezone: string, now: Date = new Date()): { day: string; start: Date; resetsAt: Date } {
  const day = localDay(now, timezone);
  return { day, start: localMidnight(day, timezone), resetsAt: localMidnight(addDays(day, 1), timezone) };
}

/** The local week (Monday 00:00 → next Monday 00:00) holding `now`. */
export function localWeekWindow(timezone: string, now: Date = new Date()): { start: Date; resetsAt: Date } {
  const day = localDay(now, timezone);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const monday = addDays(day, -((dow + 6) % 7));
  return { start: localMidnight(monday, timezone), resetsAt: localMidnight(addDays(monday, 7), timezone) };
}

/** Next UTC midnight (the legacy daily Fitzy window). */
export function nextUtcMidnight(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------- food scans

export type FoodScanMode = 'unlimited' | 'legacy' | 'starter' | 'daily' | 'exhausted';

export interface FoodScanAllowance {
  mode: FoodScanMode;
  remaining: number | null;
  starterTotal: number | null;
  starterRemaining: number | null;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  resetsAt: string | null;
  timezone: string;
}

/**
 * Daily used with no double counting across the starter → daily boundary (§2.1):
 *   starterLeftAtDayStart = max(0, total − (L − T)),  dailyUsed = max(0, T − starterLeftAtDayStart)
 * where L = lifetime rows and T = rows since local midnight.
 */
export function dailyScansUsed(total: number, lifetimeUsed: number, todayUsed: number): number {
  const t = Math.max(0, Math.min(todayUsed, lifetimeUsed));
  const starterLeftAtDayStart = Math.max(0, total - (lifetimeUsed - t));
  return Math.max(0, t - starterLeftAtDayStart);
}

export interface FreeScanFacts {
  total: number;
  daily: number;
  lifetimeUsed: number;
  todayUsed: number;
  timezone: string;
  resetsAt: Date;
}

/** The allowance of a FREE user with the gate live. */
export function freeFoodScanAllowance(f: FreeScanFacts): FoodScanAllowance {
  const starterRemaining = Math.max(0, f.total - f.lifetimeUsed);
  const dailyLimit = f.daily > 0 ? f.daily : null;
  if (starterRemaining > 0) {
    return { mode: 'starter', remaining: starterRemaining, starterTotal: f.total, starterRemaining, dailyLimit, dailyRemaining: null, resetsAt: null, timezone: f.timezone };
  }
  if (f.daily <= 0) {
    return { mode: 'exhausted', remaining: 0, starterTotal: f.total, starterRemaining: 0, dailyLimit: null, dailyRemaining: null, resetsAt: null, timezone: f.timezone };
  }
  const dailyRemaining = Math.max(0, f.daily - dailyScansUsed(f.total, f.lifetimeUsed, f.todayUsed));
  return {
    mode: 'daily',
    remaining: dailyRemaining,
    starterTotal: f.total,
    starterRemaining: 0,
    dailyLimit,
    dailyRemaining,
    resetsAt: f.resetsAt.toISOString(),
    timezone: f.timezone,
  };
}

export function unmeteredFoodScanAllowance(mode: 'unlimited' | 'legacy', timezone: string): FoodScanAllowance {
  return { mode, remaining: null, starterTotal: null, starterRemaining: null, dailyLimit: null, dailyRemaining: null, resetsAt: null, timezone };
}

// ---------------------------------------------------------------- Fitzy

export type FitzyAllowanceMode = 'unlimited' | 'weekly' | 'daily' | 'locked';

export interface FitzyAllowance {
  mode: FitzyAllowanceMode;
  limit: number | null;
  used: number | null;
  remaining: number | null;
  window: 'week' | 'day' | null;
  resetsAt: string | null;
}

export const UNLIMITED_FITZY_ALLOWANCE: FitzyAllowance = { mode: 'unlimited', limit: null, used: null, remaining: null, window: null, resetsAt: null };

export function fitzyAllowanceFrom(input: { window: 'week' | 'day'; limit: number; used: number; resetsAt: Date }): FitzyAllowance {
  const mode: FitzyAllowanceMode = input.window === 'week' ? 'weekly' : input.limit > 0 ? 'daily' : 'locked';
  return {
    mode,
    limit: input.limit,
    used: input.used,
    remaining: Math.max(0, input.limit - input.used),
    window: input.window,
    resetsAt: input.resetsAt.toISOString(),
  };
}

/**
 * Pure date/streak math shared by every streak service.
 *
 * Rules of the road:
 * - A "day" is always a YYYY-MM-DD string in the USER'S local timezone.
 *   Never call new Date().toISOString() to derive a user-facing date —
 *   that's the server's clock (UTC on Vercel), which is wrong for anyone
 *   east of UTC in their morning or west of UTC in their evening.
 * - All arithmetic on day strings goes through UTC operations on a
 *   `<date>T00:00:00Z` anchor so DST and server timezone can't skew it.
 */

import { GRACE_PERIOD_HOURS, RETROACTIVE_WINDOW_DAYS } from './streak-config';

/** Today's YYYY-MM-DD in the given IANA timezone (UTC if absent/invalid). */
export function localToday(timezone?: string | null): string {
  if (timezone) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      // fall through to UTC
    }
  }
  return new Date().toISOString().split('T')[0];
}

/** True when `timezone` is an IANA zone Intl can resolve. */
export function isValidTimezone(timezone?: string | null): timezone is string {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The YYYY-MM-DD local day that `instant` falls on in `timezone` (UTC if the
 * zone is absent/invalid). This is how "when was this meal eaten" becomes
 * "which streak day does it count for".
 */
export function localDayOf(instant: Date | string, timezone?: string | null): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return localToday(timezone);
  if (timezone) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    } catch {
      // fall through to UTC
    }
  }
  return date.toISOString().split('T')[0];
}

/** dayStr + delta days, as YYYY-MM-DD (delta may be negative). */
export function addDays(dayStr: string, delta: number): string {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().split('T')[0];
}

/** Whole days from `fromDay` to `toDay` (positive when toDay is later). */
export function daysBetween(fromDay: string, toDay: string): number {
  const from = new Date(`${fromDay}T00:00:00Z`).getTime();
  const to = new Date(`${toDay}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Current local hour (0-23) in the given timezone; null if tz invalid. */
export function localHour(timezone?: string | null): number | null {
  if (!timezone) return new Date().getUTCHours();
  try {
    return parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      }).format(new Date()),
      10
    ) % 24; // Intl reports midnight as "24" in some ICU versions
  } catch {
    return null;
  }
}

/** Within the 3am grace window for claiming yesterday? */
export function isWithinGracePeriod(timezone?: string | null): boolean {
  const hour = localHour(timezone);
  return hour !== null && hour < GRACE_PERIOD_HOURS;
}

/** Is `dayStr` claimable relative to the user's local today? */
export function isWithinRetroactiveWindow(dayStr: string, todayStr: string): boolean {
  const diff = daysBetween(dayStr, todayStr);
  return diff >= 0 && diff < RETROACTIVE_WINDOW_DAYS;
}

/**
 * The canonical streak calculation.
 *
 * Counts consecutive claimed days walking backwards from the user's local
 * today. Today itself is a free pass — an unclaimed today doesn't break
 * the streak (the user still has all day to claim it); the count then
 * continues from yesterday.
 *
 * @param claimDates set of YYYY-MM-DD strings with a streak_claims row
 * @param todayStr   the user's local today (from localToday(tz))
 * @param horizon    how many days back to look (bounds the loop)
 */
export function calculateStreak(
  claimDates: ReadonlySet<string>,
  todayStr: string,
  horizon: number = 730
): number {
  let streak = 0;
  for (let i = 0; i < horizon; i++) {
    const day = addDays(todayStr, -i);
    if (claimDates.has(day)) {
      streak++;
    } else if (i === 0) {
      continue; // today is a free pass
    } else {
      break;
    }
  }
  return streak;
}

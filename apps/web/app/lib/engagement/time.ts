/**
 * Timezone + ISO-week helpers for lifecycle messaging. Pure (Intl only), so
 * the selection logic is testable with a fixed clock.
 */

/** profiles.timezone defaults to 'UTC' at the column level, which in practice means "never set". */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone a user's messages are scheduled in (same rule as campaign delivery). */
export function userTimezone(tz: string | null | undefined): string {
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC' || !isValidTimezone(tz)) return DEFAULT_TIMEZONE;
  return tz;
}

export interface LocalClock {
  /** YYYY-MM-DD in the user's zone. */
  date: string;
  hour: number;
  /** 1 = Monday … 7 = Sunday (ISO). */
  isoWeekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localClock(timeZone: string, now: Date): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    isoWeekday: WEEKDAYS[get('weekday')] ?? 1,
  };
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** ISO week key of a local date, e.g. '2026-W44'. */
export function isoWeekKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Monday..Sunday local dates of the ISO week containing `day`. */
export function isoWeekBounds(day: string): { start: string; end: string } {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
  const start = addDays(day, 1 - weekday);
  return { start, end: addDays(start, 6) };
}

/** Monday of an ISO week key ('2026-W44' → '2026-10-26'). Null when malformed. */
export function isoWeekStart(key: string): string | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() || 7;
  jan4.setUTCDate(jan4.getUTCDate() - (jan4Weekday - 1) + (week - 1) * 7);
  const start = jan4.toISOString().slice(0, 10);
  return isoWeekKey(start) === key ? start : null;
}

/** UTC instant of local midnight starting `day` in `timeZone` (DST-safe to the hour). */
export function localMidnightUtc(day: string, timeZone: string): Date {
  // Guess UTC midnight, then correct by the zone's offset at that instant (twice for DST edges).
  let t = Date.parse(`${day}T00:00:00Z`);
  for (let i = 0; i < 2; i++) {
    const c = localClock(timeZone, new Date(t));
    const minutes = Number(
      new Intl.DateTimeFormat('en-US', { timeZone, minute: '2-digit' }).format(new Date(t))
    );
    const localAsUtc = Date.parse(`${c.date}T00:00:00Z`) + c.hour * 3_600_000 + minutes * 60_000;
    t -= localAsUtc - Date.parse(`${day}T00:00:00Z`);
  }
  return new Date(t);
}

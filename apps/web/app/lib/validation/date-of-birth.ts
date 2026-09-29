/**
 * Date of birth normalisation for PUT /api/mobile/profile.
 *
 * `profiles.date_of_birth` is a calendar DATE: the day the user picked, with no
 * time and no zone. Clients send it in two ways:
 *
 *   Android  "1984-09-26"              (the calendar date itself)
 *   iOS      "1984-09-26T07:00:00Z"    (a `Date` encoded by JSONEncoder `.iso8601`,
 *                                       always in UTC, always with "Z")
 *
 * The iOS value is an INSTANT, so its date part is the UTC date, which is not
 * always the day the user picked:
 *
 *   picked 14 May in Los Angeles (UTC-7)  -> "2000-05-14T07:00:00Z"  date part = 14  (right)
 *   picked 14 May in Kolkata (UTC+5:30)   -> "2000-05-13T18:30:00Z"  date part = 13  (WRONG)
 *   picked 14 May in LA at 18:00 local    -> "2000-05-15T01:00:00Z"  date part = 15  (WRONG)
 *
 * THE RULE (first match wins)
 *
 *   1. "YYYY-MM-DD"                       -> that date, unchanged.
 *   2. Datetime with its own non-zero UTC offset ("+05:30", "-07:00"), or with no
 *      zone at all                        -> the string's own date part. The
 *      client wrote its local wall-clock time, so the date part IS the local date.
 *   3. Datetime in UTC ("Z" / "+00:00"):
 *      a. exactly 00:00:00 UTC and the date part equals the date already stored
 *                                         -> that date (no change). The auth
 *         responses (login / session / Apple / Google) hand the stored date out
 *         as "YYYY-MM-DDT00:00:00.000Z"; a client echoing that back unchanged
 *         must not shift the date, whatever its zone.
 *      b. the client's IANA zone is known (the `X-Client-Timezone` header, sent
 *         by iOS on every request)        -> the calendar date of that instant
 *         IN THAT ZONE. Exact for any time of day and for historical DST.
 *      c. zone unknown, and the time looks like a local midnight (seconds = 0,
 *         minutes on a quarter hour, which is what every real UTC offset gives):
 *           time of day <= 12:00 UTC      -> the string's own date part
 *                                            (zone behind UTC, e.g. the Americas)
 *           time of day >  12:00 UTC      -> date part + 1 day
 *                                            (zone ahead of UTC, e.g. Europe, Asia)
 *      d. otherwise                       -> the string's own date part.
 *
 * Known limit of 3c (only reached without the header): 10:00–12:00 UTC is
 * ambiguous between UTC-10…-12 (Hawaii) and UTC+12…+14 (New Zealand, Fiji); it
 * is read as "behind UTC".
 */
import { addDays, isValidTimezone, localDayOf } from '@/lib/streaks/streak-calculator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

export interface DateOfBirthContext {
  /** IANA zone of the device that picked the date (X-Client-Timezone). */
  timeZone?: string | null;
  /** The date currently stored for this user, "YYYY-MM-DD". */
  storedDate?: string | null;
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2000-02-30). */
export function isCalendarDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Offset in minutes east of UTC; `Z` is 0. Null when the text is not an offset. */
function parseOffsetMinutes(zone: string): number | null {
  if (zone === 'Z' || zone === 'z') return 0;
  const match = /^([+-])(\d{2})(?::?(\d{2}))?$/.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? '0');
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return match[1] === '-' ? -total : total;
}

/** Shape check only: is this something `normalizeDateOfBirth` can read? */
export function isDateOfBirthInput(value: string): boolean {
  return normalizeDateOfBirth(value) !== null;
}

/**
 * The calendar date (YYYY-MM-DD) the user picked, or null when `input` is not a
 * date or datetime. See the rule at the top of this file.
 */
export function normalizeDateOfBirth(input: string, context: DateOfBirthContext = {}): string | null {
  const value = input.trim();

  // 1. Calendar date.
  if (DATE_ONLY.test(value)) return isCalendarDate(value) ? value : null;

  const match = DATE_TIME.exec(value);
  if (!match) return null;
  const [, datePart, hh, mm, ss = '00', fraction = '', zone] = match;
  const hours = Number(hh);
  const minutes = Number(mm);
  const seconds = Number(ss);
  if (!isCalendarDate(datePart) || hours > 23 || minutes > 59 || seconds > 59) return null;

  // 2. Local wall-clock time (own offset, or no zone).
  if (zone === undefined) return datePart;
  const offsetMinutes = parseOffsetMinutes(zone);
  if (offsetMinutes === null) return null;
  if (offsetMinutes !== 0) return datePart;

  // 3. UTC instant.
  const wholeSecond = /^0*$/.test(fraction);
  const isUtcMidnight = hours === 0 && minutes === 0 && seconds === 0 && wholeSecond;

  // 3a. Echo of the value the auth responses hand out.
  if (isUtcMidnight && context.storedDate === datePart) return datePart;

  // 3b. The zone the date was picked in.
  if (isValidTimezone(context.timeZone)) {
    const instant = new Date(`${datePart}T${hh}:${mm}:${ss}Z`);
    if (Number.isNaN(instant.getTime())) return null;
    const local = localDayOf(instant, context.timeZone);
    return isCalendarDate(local) ? local : datePart;
  }

  // 3c. No zone: a local midnight seen from UTC.
  const looksLikeLocalMidnight = seconds === 0 && wholeSecond && minutes % 15 === 0;
  if (looksLikeLocalMidnight && hours * 60 + minutes > 12 * 60) return addDays(datePart, 1);

  // 3d.
  return datePart;
}

/** Same check the route always applied: the date, read as UTC midnight, is not after now. */
export function isFutureCalendarDate(date: string, now: number = Date.now()): boolean {
  const time = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isNaN(time) || time > now;
}

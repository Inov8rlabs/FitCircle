/**
 * Reads the body of POST /api/mobile/streaks/engagement/pause.
 *
 * What the shipped clients send:
 * - iOS:      `{ "resume_date": "2026-10-05T17:23:11Z" }` (ISO-8601 instant from
 *             a date picker limited to today..+90 days), or `{}` for "until I
 *             resume".
 * - Android:  `{ "resume_date": "2026-10-05" }`.
 * - Android before the 2026-09 parity pass: `{ "days": 7 }`. The route never
 *   read `days`, so those pauses silently ran for the 90-day maximum.
 *
 * Rules:
 * - `resume_date` wins when it is present.
 * - `days` is used only when `resume_date` is absent. It is capped at 90 and a
 *   value that is not a whole number >= 1 is ignored, which is what happened to
 *   every `days` before.
 * - Neither: no resume date, the service pauses for the 90-day maximum.
 */

import { MAX_PAUSE_DURATION_DAYS } from '../types/streak';

import { addDays, daysBetween, isValidTimezone, localDayOf, localToday } from './streak-calculator';

export type PauseRequest =
  | {
      ok: true;
      /** YYYY-MM-DD, or undefined for "no resume date given". */
      resumeDate: string | undefined;
      source: 'resume_date' | 'days' | 'default';
    }
  | {
      ok: false;
      code: 'INVALID_RESUME_DATE' | 'RESUME_DATE_NOT_IN_FUTURE' | 'PAUSE_TOO_LONG';
      /** Human readable; the two range messages are the route's historical wording. */
      error: string;
    };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function firstPresent(body: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * The calendar days a client can have meant by `resume_date`, best reading
 * first. Empty when the value is unreadable.
 *
 * A date has one reading. An instant belongs to a different calendar day
 * depending on the zone, so it has two: the day in the client's zone (what the
 * user saw in the date picker) and the date part of the string as sent, which
 * is how this route always read it. The second one is kept as a fallback so
 * that no request that used to be accepted is refused now.
 */
function resumeDayReadings(raw: unknown, timezone?: string | null): string[] {
  if (typeof raw !== 'string') return [];
  const value = raw.trim();
  if (DATE_ONLY.test(value)) {
    return Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? [] : [value];
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return [];

  const readings: string[] = [];
  if (isValidTimezone(timezone)) readings.push(localDayOf(instant, timezone));
  const datePart = value.slice(0, 10);
  readings.push(DATE_ONLY.test(datePart) ? datePart : localDayOf(instant, null));
  return Array.from(new Set(readings));
}

function toWholeDays(raw: unknown): number | null {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const whole = Math.floor(value);
  return whole >= 1 ? whole : null;
}

export function readPauseRequest(
  body: Record<string, unknown>,
  timezone?: string | null
): PauseRequest {
  const today = localToday(timezone);

  const rawResumeDate = firstPresent(body, ['resume_date', 'resumeDate']);
  if (rawResumeDate !== undefined) {
    const readings = resumeDayReadings(rawResumeDate, timezone);
    if (readings.length === 0) {
      return {
        ok: false,
        code: 'INVALID_RESUME_DATE',
        error: 'Resume date must be a date (YYYY-MM-DD) or an ISO-8601 timestamp',
      };
    }

    const inRange = readings.find((day) => {
      const duration = daysBetween(today, day);
      return duration >= 1 && duration <= MAX_PAUSE_DURATION_DAYS;
    });
    if (inRange) return { ok: true, resumeDate: inRange, source: 'resume_date' };

    if (daysBetween(today, readings[0]) < 1) {
      return { ok: false, code: 'RESUME_DATE_NOT_IN_FUTURE', error: 'Resume date must be in the future' };
    }
    return {
      ok: false,
      code: 'PAUSE_TOO_LONG',
      error: `Resume date cannot be more than ${MAX_PAUSE_DURATION_DAYS} days in the future`,
    };
  }

  const days = toWholeDays(firstPresent(body, ['days']));
  if (days !== null) {
    return {
      ok: true,
      resumeDate: addDays(today, Math.min(days, MAX_PAUSE_DURATION_DAYS)),
      source: 'days',
    };
  }

  return { ok: true, resumeDate: undefined, source: 'default' };
}

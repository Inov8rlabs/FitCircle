/**
 * Trial-ending reminder timing (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §3.2, §5.7). Pure.
 * Works for any trial length: it only looks at trial_ends_at (the store's expiry).
 *
 * Target: 10:00 in the user's timezone, at least 24 h before trial_ends_at — formally the
 * latest 10:00-local instant that is ≥ 24 h before the end, so the lead time is 24–48 h
 * (the trial ends "tomorrow" or "on <weekday>"; the push names the day, endsPhrase).
 *
 *  - before the target                 → wait ('not_yet')
 *  - target passed (late trial start,
 *    cron outage, very short trial)    → send now, as long as ≥ 1 h remains
 *  - in the user's quiet hours         → defer to the next hourly run
 *  - < 1 h left / already ended        → give up ('too_late')
 */
import { addDays, localDayOf } from '../streaks/streak-calculator';

export const REMINDER_LOCAL_HOUR = 10;
/** Store-trial reminder: at least 24 h before the end (lead 24–48 h). */
export const REMINDER_MIN_LEAD_MS = 24 * 3_600_000;
/** "The day before" rule (10:00 + 14 h = midnight): lead 14–38 h. Used by the Pro lifecycle push. */
export const DAY_BEFORE_MIN_LEAD_MS = 14 * 3_600_000;
export const REMINDER_LAST_CALL_MS = 1 * 3_600_000;
/** How far ahead the cron looks for trials to remind (≥ the 48 h maximum lead, + DST slack). */
export const REMINDER_LOOKAHEAD_MS = 50 * 3_600_000;

/** Milliseconds `timezone` is ahead of UTC at `instant` (e.g. −4 h → −14 400 000). */
export function tzOffsetMs(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant of `hh:00` local time on local date `day` (YYYY-MM-DD) in `timezone`. */
export function localWallTimeToUtc(day: string, hour: number, timezone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let t = guess - tzOffsetMs(new Date(guess), timezone);
  // Second pass settles DST transitions between the guess and the answer.
  t = guess - tzOffsetMs(new Date(t), timezone);
  return new Date(t);
}

/** Latest 10:00-local instant at least `minLeadMs` (default 24 h) before the end. */
export function reminderSendAt(trialEndsAt: Date, timezone: string, minLeadMs: number = REMINDER_MIN_LEAD_MS): Date {
  const latest = new Date(trialEndsAt.getTime() - minLeadMs);
  let day = localDayOf(latest, timezone);
  let at = localWallTimeToUtc(day, REMINDER_LOCAL_HOUR, timezone);
  if (at.getTime() > latest.getTime()) {
    day = addDays(day, -1);
    at = localWallTimeToUtc(day, REMINDER_LOCAL_HOUR, timezone);
  }
  return at;
}

export type TrialReminderSkip = 'not_yet' | 'quiet_hours' | 'too_late';

export function decideTrialReminder(input: {
  now: Date;
  trialEndsAt: Date;
  timezone: string;
  inQuietHours: boolean;
}): { send: true; sendAt: Date } | { send: false; skip: TrialReminderSkip; sendAt: Date } {
  const sendAt = reminderSendAt(input.trialEndsAt, input.timezone);
  if (input.trialEndsAt.getTime() - input.now.getTime() < REMINDER_LAST_CALL_MS) return { send: false, skip: 'too_late', sendAt };
  if (input.now.getTime() < sendAt.getTime()) return { send: false, skip: 'not_yet', sendAt };
  if (input.inQuietHours) return { send: false, skip: 'quiet_hours', sendAt };
  return { send: true, sendAt };
}

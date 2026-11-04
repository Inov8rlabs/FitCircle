/**
 * Push timing for the Pro lifecycle prompts. Pure.
 *
 *  pro_expiring_reminder  same rule as the store-trial reminder
 *                         (lib/trials/reminder.ts): 10:00 local on the day
 *                         before Pro ends (the latest 10:00 at least 14 h
 *                         before the end), or right away when that moment has
 *                         passed and ≥ 1 h of Pro is left. Quiet hours defer
 *                         to the next hourly run.
 *  pro_expired            right after the downgrade; quiet hours defer to the
 *                         next hourly run; given up EXPIRED_PUSH_MAX_LAG_MS
 *                         after the end (a "your Pro ended" push days later
 *                         reads as spam).
 */
import { REMINDER_LAST_CALL_MS, reminderSendAt } from '../trials/reminder';

export const EXPIRING_LOOKAHEAD_MS = 40 * 3_600_000;
export const EXPIRING_LAST_CALL_MS = REMINDER_LAST_CALL_MS;
export const EXPIRED_PUSH_MAX_LAG_MS = 36 * 3_600_000;

export type PushSkip = 'not_yet' | 'quiet_hours' | 'too_late';

export type PushDecision = { send: true; sendAt: Date } | { send: false; skip: PushSkip; sendAt: Date | null };

/** When the "ends tomorrow" push is due for an end at `endsAt` in `timezone`. */
export function expiringPushAt(endsAt: Date, timezone: string): Date {
  return reminderSendAt(endsAt, timezone);
}

export function decideExpiringPush(input: { now: Date; endsAt: Date; timezone: string; inQuietHours: boolean }): PushDecision {
  const sendAt = expiringPushAt(input.endsAt, input.timezone);
  if (input.endsAt.getTime() - input.now.getTime() < EXPIRING_LAST_CALL_MS) return { send: false, skip: 'too_late', sendAt };
  if (input.now.getTime() < sendAt.getTime()) return { send: false, skip: 'not_yet', sendAt };
  if (input.inQuietHours) return { send: false, skip: 'quiet_hours', sendAt };
  return { send: true, sendAt };
}

export function decideExpiredPush(input: { now: Date; endedAt: Date; inQuietHours: boolean }): PushDecision {
  if (input.now.getTime() < input.endedAt.getTime()) return { send: false, skip: 'not_yet', sendAt: input.endedAt };
  if (input.now.getTime() - input.endedAt.getTime() > EXPIRED_PUSH_MAX_LAG_MS) return { send: false, skip: 'too_late', sendAt: null };
  if (input.inQuietHours) return { send: false, skip: 'quiet_hours', sendAt: input.endedAt };
  return { send: true, sendAt: input.now };
}

/** Idempotency key: one push per user per state per end time (a renewed end is a new key). */
export function lifecyclePushDedupeKey(type: string, userId: string, endsAt: string): string {
  return `${type}:${userId}:${endsAt.slice(0, 16)}`;
}

/** Wall-clock "Sat, Nov 8, 10:00 AM CST" in `timezone` (admin + dry-run reports). */
export function localTimeLabel(at: Date, timezone: string): string {
  try {
    return at.toLocaleString('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch {
    return at.toISOString();
  }
}

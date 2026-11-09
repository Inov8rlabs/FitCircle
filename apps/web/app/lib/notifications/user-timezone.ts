/**
 * Which IANA timezone a user's pushes are timed in (quiet hours, the daily cap's
 * "today", meal slots, the Day-1 morning push). PURE.
 *
 * Why this exists (retention diagnosis 2026-11-09): two defaults hid the user's
 * real zone.
 *   - notification_preferences.quiet_hours_timezone is created as
 *     'America/New_York' for everyone (210 of 218 rows), so quiet hours and the
 *     cap ran on New York time for users in Kolkata or Los Angeles.
 *   - profiles.timezone defaults to 'UTC'; 31% of real users still had it.
 * So: a quiet-hours zone the user (or app) actually changed wins; otherwise the
 * device zone stored on the profile; otherwise the zone of their latest streak
 * claim; otherwise the New York default (the old behaviour).
 */
import { isValidTimezone } from '@/lib/streaks/streak-calculator';

export const DEFAULT_NOTIFICATION_TZ = 'America/New_York';

/** Zones that are stored defaults, not a device's real zone. */
const PLACEHOLDER_ZONES = new Set(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Z', 'Universal', 'Etc/Universal', 'Zulu']);

/** True when `tz` is missing, invalid, or a default like 'UTC' that no real device reports. */
export function isPlaceholderTimezone(tz: string | null | undefined): boolean {
  if (!tz || !tz.trim()) return true;
  if (PLACEHOLDER_ZONES.has(tz.trim())) return true;
  return !isValidTimezone(tz);
}

export interface TimezoneSources {
  /** notification_preferences.quiet_hours_timezone */
  quietHoursTimezone?: string | null;
  /** profiles.timezone (synced from X-Client-Timezone) */
  profileTimezone?: string | null;
  /** streak_claims.timezone of the latest claim */
  claimTimezone?: string | null;
}

export function resolveNotificationTimezone(s: TimezoneSources): string {
  const q = s.quietHoursTimezone ?? null;
  if (!isPlaceholderTimezone(q) && q !== DEFAULT_NOTIFICATION_TZ) return q!;
  if (!isPlaceholderTimezone(s.profileTimezone)) return s.profileTimezone!;
  if (!isPlaceholderTimezone(s.claimTimezone)) return s.claimTimezone!;
  if (!isPlaceholderTimezone(q)) return q!;
  return DEFAULT_NOTIFICATION_TZ;
}

/** Local wall clock in `tz`: YYYY-MM-DD and minutes since local midnight. */
export function localClockIn(now: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/**
 * The calendar day a food / water / beverage entry belongs to.
 *
 * Clients send `logged_at` (an instant) but usually no `entry_date`. Taking the
 * UTC date of that instant files every evening entry in the Americas under the
 * NEXT day (a 10 pm snack in Toronto is 02:00 UTC tomorrow), which breaks daily
 * totals, streaks and circle summaries. The day is the instant's LOCAL day in
 * the person's timezone at log time: the body's `timezone` (an offline-queued
 * entry carries the zone it was logged in, so a sync after travel still files
 * it under the right day), else the app's `x-client-timezone` header, else the
 * profile's timezone, else UTC.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { CLIENT_TIMEZONE_HEADER } from '@/lib/streaks/client-timezone';
import { isValidTimezone, localDayOf } from '@/lib/streaks/streak-calculator';
import { getUserTimezone } from '@/lib/utils/timezone';

export type EntryTimezoneSource = 'body' | 'header' | 'profile' | 'default';

export interface EntryTimezone {
  /** The IANA zone the entry's day is computed in. */
  timezone: string;
  source: EntryTimezoneSource;
  /** A body `timezone` that was sent but isn't a valid IANA zone (and so was not used). */
  rejected?: string;
}

/**
 * Which timezone dates an entry. A body `timezone` that isn't a valid IANA zone
 * is never used: it's reported in `rejected` and the next source applies, so
 * a queued entry with a bad zone still syncs (a 400 would be dropped forever by
 * an offline outbox) under the same day it would have had before.
 */
export async function resolveEntryTimezone(
  request: { headers: { get(name: string): string | null } },
  bodyTimezone: unknown,
  userId: string,
  supabase: SupabaseClient,
  /** The caller's loaded profile row; its `timezone` saves the profile lookup. */
  profile?: { timezone?: string | null } | null
): Promise<EntryTimezone> {
  const sent = bodyTimezone !== undefined && bodyTimezone !== null && bodyTimezone !== '';
  const rejected =
    sent && !(typeof bodyTimezone === 'string' && isValidTimezone(bodyTimezone))
      ? String(bodyTimezone).slice(0, 64)
      : undefined;
  const extra = rejected !== undefined ? { rejected } : {};

  if (sent && rejected === undefined) return { timezone: bodyTimezone as string, source: 'body' };

  const header = request.headers.get(CLIENT_TIMEZONE_HEADER);
  if (isValidTimezone(header)) return { timezone: header, source: 'header', ...extra };

  let profileTz: string | null | undefined;
  if (profile && 'timezone' in profile) {
    profileTz = profile.timezone;
  } else {
    // Never let dating an entry fail the save: any lookup problem means UTC.
    profileTz = await getUserTimezone(userId, supabase).catch(() => null);
  }
  // A profile 'UTC' is usually the column default, not a choice: report it as
  // 'default' so callers with a better fallback (the streak claim) keep theirs.
  if (isValidTimezone(profileTz) && profileTz !== 'UTC') {
    return { timezone: profileTz, source: 'profile', ...extra };
  }
  return { timezone: 'UTC', source: 'default', ...extra };
}

/** The local day `logged_at` (default now) falls on in `timezone`, unless `entry_date` was sent. */
export function entryDateIn(
  input: { entry_date?: string | null; logged_at?: string | null },
  timezone: string
): string {
  if (input.entry_date) return input.entry_date;
  return localDayOf(input.logged_at ?? new Date(), timezone);
}

export async function resolveEntryDate(
  request: { headers: { get(name: string): string | null } },
  input: { entry_date?: string | null; logged_at?: string | null; timezone?: unknown },
  userId: string,
  supabase: SupabaseClient,
  /** The caller's loaded profile row; its `timezone` saves the profile lookup. */
  profile?: { timezone?: string | null } | null
): Promise<string> {
  if (input.entry_date) return input.entry_date;
  const { timezone } = await resolveEntryTimezone(request, input.timezone, userId, supabase, profile);
  return entryDateIn(input, timezone);
}

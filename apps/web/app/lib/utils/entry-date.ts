/**
 * The calendar day a food / water / beverage entry belongs to.
 *
 * Clients send `logged_at` (an instant) but usually no `entry_date`. Taking the
 * UTC date of that instant files every evening entry in the Americas under the
 * NEXT day (a 10 pm snack in Toronto is 02:00 UTC tomorrow), which breaks daily
 * totals, streaks and circle summaries. The day is the instant's LOCAL day in
 * the person's timezone: the app's `x-client-timezone` header, else the
 * profile's timezone, else UTC.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveClientTimezone } from '@/lib/streaks/client-timezone';
import { localDayOf } from '@/lib/streaks/streak-calculator';
import { getUserTimezone } from '@/lib/utils/timezone';

export async function resolveEntryDate(
  request: { headers: { get(name: string): string | null } },
  input: { entry_date?: string | null; logged_at?: string | null; timezone?: unknown },
  userId: string,
  supabase: SupabaseClient
): Promise<string> {
  if (input.entry_date) return input.entry_date;
  let timezone = resolveClientTimezone(request, input.timezone);
  if (!timezone) {
    // Never let dating an entry fail the save: any lookup problem means UTC.
    timezone = await getUserTimezone(userId, supabase).catch(() => 'UTC');
  }
  return localDayOf(input.logged_at ?? new Date(), timezone);
}

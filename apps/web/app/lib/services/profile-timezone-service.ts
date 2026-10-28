/**
 * Keeps profiles.timezone in step with the device. Nothing wrote it from the
 * apps, so 92 of 94 profiles still had the 'UTC' default (2026-10-28) and any
 * server code falling back to profiles.timezone (meal-reminder pushes, trial
 * reminders, Fitzy grounding) ran on London time. The home feed is fetched on
 * every app open with X-Client-Timezone, so it's the natural place to sync.
 */
import { createAdminSupabase } from '@/lib/supabase-admin';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';

export class ProfileTimezoneService {
  /** The timezone to store, or null when nothing should change. */
  static pendingUpdate(current: string | null | undefined, clientTimezone: string | null | undefined): string | null {
    if (!isValidTimezone(clientTimezone)) return null;
    return clientTimezone === current ? null : clientTimezone;
  }

  /** Best-effort write; never throws (callers run it after the response). */
  static async syncFromClient(userId: string, current: string | null | undefined, clientTimezone: string | null | undefined): Promise<void> {
    const next = this.pendingUpdate(current, clientTimezone);
    if (!next) return;
    try {
      const { error } = await createAdminSupabase().from('profiles').update({ timezone: next }).eq('id', userId);
      if (error) console.warn('[ProfileTimezoneService] update failed:', error.message);
    } catch (err) {
      console.warn('[ProfileTimezoneService] update failed:', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Once-per-user conversion milestones (ad optimisation signals).
 *
 * Returned to the apps as `meta.milestones: string[]` on the request that
 * reaches the milestone, so the client can log the matching Firebase / GA4
 * event (Android → Google Ads in-app action). The server is the source of
 * truth: it counts across devices and reinstalls, and records the milestone so
 * it is reported once per user.
 *
 * `meals_logged_3_days`: the user has food entries on 3 distinct local days.
 *  - "Local day" = food_log_entries.entry_date, which the create route files in
 *    the user's zone at log time (body `timezone` → X-Timezone header →
 *    profile → UTC; lib/utils/entry-date.ts) — the same day the streak claims.
 *  - Fires only on the create that adds the user's 3rd distinct day (a new day,
 *    with exactly 2 other days already logged). Users already past 3 days when
 *    this shipped never fire; logging more meals on an already-counted day
 *    never fires.
 *  - Exactly once: recorded in profiles.metadata.milestones.<name> by a
 *    conditional update (`… where metadata->milestones-><name> is null`), so two
 *    concurrent creates (two devices) can't both report it, and deleting a day
 *    then logging a new one doesn't report it again.
 *  - A retried create (same client id, `meta.duplicate`) that originally
 *    reached the milestone reports it again: the first response was lost, so
 *    the client never saw it. Clients also dedupe locally.
 *
 * No migration: profiles.metadata (jsonb, default '{}') was otherwise unused
 * by app code (only seed/QA keys). Never throws — a failure just omits the
 * milestone; the create is unaffected.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const MEALS_LOGGED_3_DAYS = 'meals_logged_3_days' as const;
export type ConversionMilestone = typeof MEALS_LOGGED_3_DAYS;

const MEAL_DAYS_TARGET = 3;

interface MilestoneRecord {
  at: string;
  entry_id?: string | null;
}

type Metadata = Record<string, any> & { milestones?: Record<string, MilestoneRecord> };

export class ConversionMilestoneService {
  /**
   * Milestones reached by this food-log create. `[]` when none (the route then
   * omits meta.milestones).
   */
  static async forFoodLogCreate(
    supabase: SupabaseClient,
    userId: string,
    entry: { id: string; entry_type?: string | null; entry_date?: string | null } | null | undefined,
    opts: { duplicate?: boolean } = {}
  ): Promise<ConversionMilestone[]> {
    try {
      if (!entry || entry.entry_type !== 'food' || !entry.entry_date) return [];

      if (opts.duplicate) {
        // Re-report only if THIS entry is the one that reached it.
        const metadata = await this.readMetadata(supabase, userId);
        return metadata?.milestones?.[MEALS_LOGGED_3_DAYS]?.entry_id === entry.id
          ? [MEALS_LOGGED_3_DAYS]
          : [];
      }

      if (!(await this.isThirdDistinctDay(supabase, userId, entry.id, entry.entry_date))) return [];
      return (await this.claim(supabase, userId, MEALS_LOGGED_3_DAYS, entry.id)) ? [MEALS_LOGGED_3_DAYS] : [];
    } catch (error) {
      console.warn('[ConversionMilestoneService] milestone check failed:', (error as Error)?.message);
      return [];
    }
  }

  /**
   * True when `day` is a new food day for the user and exactly 2 other days
   * already have food. Indexed point reads only (no full scan of the log):
   * another entry on `day`? then the first, second and third other days.
   */
  private static async isThirdDistinctDay(
    supabase: SupabaseClient,
    userId: string,
    entryId: string,
    day: string
  ): Promise<boolean> {
    const foodRows = () =>
      supabase
        .from('food_log_entries')
        .select('entry_date')
        .eq('user_id', userId)
        .eq('entry_type', 'food')
        .is('deleted_at', null);

    const { data: sameDay, error: sameDayError } = await foodRows()
      .eq('entry_date', day)
      .neq('id', entryId)
      .limit(1);
    if (sameDayError) throw sameDayError;
    if ((sameDay ?? []).length > 0) return false; // day already counted

    // Walk the other distinct days in order: d1 < d2 < d3.
    let after: string | null = null;
    for (let n = 0; n < MEAL_DAYS_TARGET; n++) {
      let q = foodRows().neq('entry_date', day);
      if (after) q = q.gt('entry_date', after);
      const { data, error } = await q.order('entry_date', { ascending: true }).limit(1);
      if (error) throw error;
      const next = (data ?? [])[0]?.entry_date as string | undefined;
      if (!next) return n === MEAL_DAYS_TARGET - 1; // exactly 2 other days
      after = next;
    }
    return false; // 3+ other days: reached long ago
  }

  /** Records the milestone if not yet recorded. True only for the request that recorded it. */
  private static async claim(
    supabase: SupabaseClient,
    userId: string,
    milestone: ConversionMilestone,
    entryId: string
  ): Promise<boolean> {
    const metadata = await this.readMetadata(supabase, userId);
    if (metadata === undefined) return false; // no profile row
    if (metadata?.milestones?.[milestone]) return false;

    const base: Metadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
    const next: Metadata = {
      ...base,
      milestones: { ...(base.milestones ?? {}), [milestone]: { at: new Date().toISOString(), entry_id: entryId } },
    };
    // Conditional on the milestone still being absent: Postgres re-checks the
    // predicate after a concurrent writer commits, so only one request wins.
    const { data, error } = await supabase
      .from('profiles')
      .update({ metadata: next })
      .eq('id', userId)
      .is(`metadata->milestones->${milestone}`, null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  /** profiles.metadata; null when empty, undefined when the profile is missing. */
  private static async readMetadata(supabase: SupabaseClient, userId: string): Promise<Metadata | null | undefined> {
    const { data, error } = await supabase.from('profiles').select('metadata').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    return (data.metadata as Metadata | null) ?? null;
  }
}

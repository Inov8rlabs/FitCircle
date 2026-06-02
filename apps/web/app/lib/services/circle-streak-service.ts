import { createAdminSupabase } from '../supabase-admin';
import {
  circleStreakMajorityThreshold,
  type CircleStreakDTO,
  type CircleStreakRow,
  type CircleStreakSaveResultDTO,
  type CircleStreakSaveRow,
} from '../types/circle-streak';

/**
 * CircleStreakService — collective circle streak + pro-social streak saves (PRD v4 §6.13).
 *
 * The circle earns a COLLECTIVE streak for consecutive days where MOST active members
 * log a calorie-bearing food entry (shared, gentle accountability). A member can cover
 * for another once per period (a streak save), making the covered member count as
 * "logged" for that day — forgiveness-first, never punish a lapse.
 *
 * All streak math lives HERE (CLAUDE.md: no stored procs / business-logic triggers).
 * The DB only stores state (circle_streaks) and the audit of saves (circle_streak_saves).
 * Authorization is explicit in-code (admin client used; 059 RLS is defense in depth).
 *
 * "MOST members" === STRICT MAJORITY (> 50%) of active members logged that day. See
 * circleStreakMajorityThreshold() in ../types/circle-streak.ts for the exact formula.
 *
 * ----------------------------------------------------------------------------
 * TODO (cross-feature, do NOT wire from this branch): when a circle streak milestone
 * is hit, the chat engine's `circle_streak` event (EVENT_TAXONOMY in
 * lib/types/circle-chat-engine.ts, currently enabledByDefault:false) should fire via
 * ChatActivityHooks — wire when the chat + nutrition branches merge. We deliberately
 * do NOT import any chat code here; recomputeForDay() returns the new streak so the
 * caller (post-merge) can detect a milestone crossing and emit the signal.
 * ----------------------------------------------------------------------------
 */
export class CircleStreakService {
  // Static methods, matching the rest of the service layer. The public methods below
  // implement EXACTLY the FROZEN signatures in ICircleStreakService
  // (../types/circle-streak.ts) — the interface is the contract; this class is the impl.

  // ==========================================================================
  // AUTHORIZATION
  // ==========================================================================

  /** Throws Error('Forbidden') if the user is not an active member of the circle. */
  static async assertActiveMember(fitcircleId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Forbidden');
  }

  // ==========================================================================
  // PUBLIC API (frozen — see ICircleStreakService in ../types/circle-streak.ts)
  // ==========================================================================

  /**
   * Recompute the collective streak for a single calendar day and persist it.
   * See ICircleStreakService.recomputeForDay for the contract.
   */
  static async recomputeForDay(fitcircleId: string, date: string): Promise<CircleStreakDTO> {
    const supabaseAdmin = createAdminSupabase();

    // 1. Active members of the circle.
    const activeUserIds = await this.activeMemberIds(fitcircleId);
    const activeCount = activeUserIds.length;

    // 2. Who logged a calorie-bearing, non-deleted food entry on `date`,
    //    UNION who has a streak save covering them on `date`. A "logged" member is
    //    counted at most once (Set), and only counts if they are an active member.
    const loggedSet = new Set<string>();

    if (activeCount > 0) {
      const activeSet = new Set(activeUserIds);

      const { data: entries, error: entriesError } = await supabaseAdmin
        .from('food_log_entries')
        .select('user_id')
        .eq('entry_date', date)
        .in('user_id', activeUserIds)
        .not('calories', 'is', null)
        .is('deleted_at', null);
      if (entriesError) throw entriesError;
      for (const row of entries ?? []) {
        if (row.user_id) loggedSet.add(row.user_id as string);
      }

      const { data: saves, error: savesError } = await supabaseAdmin
        .from('circle_streak_saves')
        .select('covered_user_id')
        .eq('fitcircle_id', fitcircleId)
        .eq('save_date', date);
      if (savesError) throw savesError;
      for (const row of saves ?? []) {
        const covered = row.covered_user_id as string;
        if (covered && activeSet.has(covered)) loggedSet.add(covered);
      }
    }

    const loggedCount = loggedSet.size;
    const threshold = circleStreakMajorityThreshold(activeCount);
    const dayQualifies = activeCount > 0 && loggedCount >= threshold;

    // 3. Current state.
    const existing = await this.fetchRow(fitcircleId);
    const prevCurrent = existing?.current_streak ?? 0;
    const prevLongest = existing?.longest_streak ?? 0;
    const prevLastActive = existing?.last_active_date ?? null;

    // 4. Apply the day to the streak.
    let nextCurrent = prevCurrent;
    let nextLastActive = prevLastActive;

    if (dayQualifies) {
      if (prevLastActive === null) {
        nextCurrent = 1;
      } else if (date === prevLastActive) {
        // Re-running the same day — idempotent; keep current.
        nextCurrent = prevCurrent === 0 ? 1 : prevCurrent;
      } else if (this.isDayAfter(prevLastActive, date)) {
        nextCurrent = prevCurrent + 1;
      } else if (date > prevLastActive) {
        // A qualifying day with a gap since the last active day — streak restarts.
        nextCurrent = 1;
      } else {
        // date < prevLastActive: a backfill of an older qualifying day. Don't
        // rewrite a more-recent anchor; just ensure longest reflects history.
        nextCurrent = prevCurrent;
      }
      // Advance the anchor only forward.
      if (nextLastActive === null || date > nextLastActive) {
        nextLastActive = date;
      }
    } else {
      // Day does not qualify.
      if (prevLastActive !== null && date < prevLastActive) {
        // Backfilled older non-qualifying day — leave the recent anchor untouched.
        nextCurrent = prevCurrent;
      } else {
        // The current (or a forward) day lapsed — reset. Forgiveness is expressed via
        // streak saves at recompute time, not by ignoring a genuine lapse here.
        nextCurrent = 0;
      }
    }

    const nextLongest = Math.max(prevLongest, nextCurrent);

    // 5. Upsert.
    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from('circle_streaks')
      .upsert(
        {
          fitcircle_id: fitcircleId,
          current_streak: nextCurrent,
          longest_streak: nextLongest,
          last_active_date: nextLastActive,
        },
        { onConflict: 'fitcircle_id' }
      )
      .select('fitcircle_id, current_streak, longest_streak, last_active_date, updated_at')
      .single();
    if (upsertError) throw upsertError;

    return this.toDTO(upserted as CircleStreakRow);
  }

  /** Active-member-gated read of a circle's collective streak. */
  static async getStreak(fitcircleId: string, viewerUserId: string): Promise<CircleStreakDTO> {
    await this.assertActiveMember(fitcircleId, viewerUserId);

    const row = await this.fetchRow(fitcircleId);
    if (!row) {
      // No streak recorded yet — return a zero DTO (the circle simply hasn't qualified).
      return {
        fitcircleId,
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        updatedAt: null,
      };
    }
    return this.toDTO(row);
  }

  /**
   * Record a pro-social streak save and recompute the covered day.
   * See ICircleStreakService.useSave for the contract.
   */
  static async useSave(
    fitcircleId: string,
    saverUserId: string,
    coveredUserId: string,
    date: string
  ): Promise<CircleStreakSaveResultDTO> {
    const supabaseAdmin = createAdminSupabase();

    // Both saver and covered must be active members of the circle.
    await this.assertActiveMember(fitcircleId, saverUserId);
    await this.assertActiveMember(fitcircleId, coveredUserId);

    // Record the save. The unique(fitcircle_id, covered_user_id, save_date) constraint
    // enforces "once per covered member per period". If it already exists, we treat the
    // call as idempotent (created=false) and still recompute.
    let created = true;
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('circle_streak_saves')
      .insert({
        fitcircle_id: fitcircleId,
        saver_user_id: saverUserId,
        covered_user_id: coveredUserId,
        save_date: date,
      })
      .select('id, fitcircle_id, saver_user_id, covered_user_id, save_date, created_at')
      .single();

    let saveRow: CircleStreakSaveRow;
    if (insertError) {
      // 23505 = unique_violation → already saved for this period.
      if ((insertError as { code?: string }).code === '23505') {
        created = false;
        const { data: existing, error: fetchError } = await supabaseAdmin
          .from('circle_streak_saves')
          .select('id, fitcircle_id, saver_user_id, covered_user_id, save_date, created_at')
          .eq('fitcircle_id', fitcircleId)
          .eq('covered_user_id', coveredUserId)
          .eq('save_date', date)
          .single();
        if (fetchError) throw fetchError;
        saveRow = existing as CircleStreakSaveRow;
      } else {
        throw insertError;
      }
    } else {
      saveRow = inserted as CircleStreakSaveRow;
    }

    // The saved member now counts as "logged" for `date` — recompute the day.
    const streak = await this.recomputeForDay(fitcircleId, date);

    return {
      save: {
        id: saveRow.id,
        fitcircleId: saveRow.fitcircle_id,
        saverUserId: saveRow.saver_user_id,
        coveredUserId: saveRow.covered_user_id,
        saveDate: saveRow.save_date,
        createdAt: saveRow.created_at,
      },
      created,
      streak,
    };
  }

  // ==========================================================================
  // INTERNALS
  // ==========================================================================

  /** Active member user_ids for a circle. */
  private static async activeMemberIds(fitcircleId: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');
    if (error) throw error;
    return (data ?? []).map((r) => r.user_id as string).filter(Boolean);
  }

  /** Fetch the stored streak row, or null if the circle has none yet. */
  private static async fetchRow(fitcircleId: string): Promise<CircleStreakRow | null> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('circle_streaks')
      .select('fitcircle_id, current_streak, longest_streak, last_active_date, updated_at')
      .eq('fitcircle_id', fitcircleId)
      .maybeSingle();
    if (error) throw error;
    return (data as CircleStreakRow | null) ?? null;
  }

  /** True if `day` (YYYY-MM-DD) is exactly one calendar day after `base`. */
  private static isDayAfter(base: string, day: string): boolean {
    const baseMs = Date.parse(`${base}T00:00:00Z`);
    const dayMs = Date.parse(`${day}T00:00:00Z`);
    if (Number.isNaN(baseMs) || Number.isNaN(dayMs)) return false;
    return dayMs - baseMs === 24 * 60 * 60 * 1000;
  }

  private static toDTO(row: CircleStreakRow): CircleStreakDTO {
    return {
      fitcircleId: row.fitcircle_id,
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      lastActiveDate: row.last_active_date,
      updatedAt: row.updated_at,
    };
  }
}

import { createAdminSupabase } from '../supabase-admin';
import {
  type EngagementStreak,
  type ActivityType,
  type EngagementStreakResponse,
  type EngagementHistoryEntry,
  type EngagementHistoryResponse,
  DEFAULT_STREAK_FREEZES,
  MAX_PAUSE_DURATION_DAYS,
  StreakError,
  STREAK_ERROR_CODES,
} from '../types/streak';
import { StreakClaimError, CLAIM_ERROR_CODES } from '../types/streak-claiming';
import { localToday, addDays, daysBetween, calculateStreak,
  isWithinRetroactiveWindow,
} from '../streaks/streak-calculator';
import { shieldXpPrice } from '../streaks/streak-config';

import { MomentumService } from './momentum-service';
import { StreakShieldService } from './streak-shield-service';
import { StreakClaimingService } from './streak-claiming-service';

/**
 * EngagementStreakService
 *
 * Tier-1 engagement streak, derived from `streak_claims` (the single source
 * of truth — see StreakClaimingService). This service owns:
 * - activity history (`engagement_activities`)
 * - the denormalized `engagement_streaks` record (fast reads, legacy clients)
 * - pause/resume for life events
 *
 * Shield inventory is owned by StreakShieldService; shield application is
 * owned by StreakClaimingService.activateFreeze. The freeze methods here are
 * thin compatibility wrappers over those.
 */
export class EngagementStreakService {
  // ============================================================================
  // CORE STREAK MANAGEMENT
  // ============================================================================

  /**
   * Record an engagement activity (history) and refresh the derived streak.
   */
  static async recordActivity(
    userId: string,
    activityType: ActivityType,
    referenceId?: string,
    activityDate?: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const date = activityDate || localToday();

    const { error: insertError } = await supabaseAdmin.from('engagement_activities').insert({
      user_id: userId,
      activity_date: date,
      activity_type: activityType,
      reference_id: referenceId || null,
    });

    // Ignore duplicate rows — recording the same activity twice is a no-op.
    if (insertError && insertError.code !== 'PGRST116' && insertError.code !== '23505') {
      console.error(`[EngagementStreakService.recordActivity] Error inserting activity:`, insertError);
      throw insertError;
    }

    await this.updateEngagementStreak(userId);

    try {
      await MomentumService.checkIn(userId);
    } catch (momentumError) {
      console.error(`[EngagementStreakService.recordActivity] Momentum check-in failed (non-blocking):`, momentumError);
    }
  }

  /**
   * Recompute the streak from claims and persist it to engagement_streaks.
   * `todayStr` lets callers anchor on the user's local date.
   */
  static async updateEngagementStreak(
    userId: string,
    todayStr?: string
  ): Promise<EngagementStreakResponse> {
    const supabaseAdmin = createAdminSupabase();

    let streakRecord = await this.getOrCreateRecord(userId);

    // If paused, don't update the streak.
    if (streakRecord.paused) {
      return this.formatStreakResponse(streakRecord);
    }

    const { data: claims, error: claimsError } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', addDays(localToday(), -730))
      .order('claim_date', { ascending: false });

    if (claimsError) throw claimsError;

    const claimDates = new Set((claims || []).map(c => c.claim_date));
    const currentStreak = calculateStreak(claimDates, todayStr || localToday());

    const lastEngagementDate =
      claims && claims.length > 0 ? claims[0].claim_date : streakRecord.last_engagement_date;
    const newLongestStreak = Math.max(currentStreak, streakRecord.longest_streak);

    const { data: updatedStreak, error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        current_streak: currentStreak,
        longest_streak: newLongestStreak,
        last_engagement_date: lastEngagementDate,
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;
    if (!updatedStreak) throw new Error('Failed to update streak');

    return this.formatStreakResponse(updatedStreak);
  }

  /**
   * Apply a shield to cover a missed day (compat wrapper over the canonical
   * shield path). Maps shield errors onto the legacy StreakError codes the
   * mobile apply-freeze route already handles.
   */
  static async applyFreeze(
    userId: string,
    missedDate?: string,
    timezone?: string
  ): Promise<EngagementStreakResponse> {
    const today = localToday(timezone);
    // No date given: protect the day that needs it — the most recent missed
    // day, which is yesterday whenever yesterday was missed. When nothing in
    // the window is missed, keep the historical default (yesterday), which
    // then answers DATE_HAS_ACTIVITY without spending a shield.
    const targetDate =
      missedDate ||
      (await StreakClaimingService.findMostRecentMissedDay(userId, timezone)) ||
      addDays(today, -1);

    // Same window activateFreeze enforces (1..RETROACTIVE_WINDOW_DAYS-1), so
    // a request can't pass here only to be rejected inside as TOO_OLD.
    const diff = daysBetween(targetDate, today);
    if (diff < 1 || !isWithinRetroactiveWindow(targetDate, today)) {
      throw new StreakError(
        'Can only apply freeze to missed days within the past 7 days',
        STREAK_ERROR_CODES.INVALID_DATE_RANGE
      );
    }

    try {
      await StreakClaimingService.activateFreeze(userId, targetDate, timezone);
    } catch (e) {
      if (e instanceof StreakClaimError) {
        // Translate EVERY claim-error onto the legacy StreakError taxonomy —
        // the mobile apply-freeze route's handler only understands
        // StreakError, and an unmapped code would surface as a raw 500.
        switch (e.code) {
          case CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE:
            throw new StreakError('No streak freezes available', STREAK_ERROR_CODES.NO_FREEZES_AVAILABLE, {
              upsell: 'pro_unlimited_shields',
            });
          case CLAIM_ERROR_CODES.ALREADY_CLAIMED:
            throw new StreakError(
              'That date already has activity - no freeze needed',
              STREAK_ERROR_CODES.DATE_HAS_ACTIVITY
            );
          case CLAIM_ERROR_CODES.FUTURE_DATE:
          case CLAIM_ERROR_CODES.TOO_OLD:
            throw new StreakError(
              'Can only apply freeze to missed days within the past 7 days',
              STREAK_ERROR_CODES.INVALID_DATE_RANGE
            );
          default:
            throw new StreakError(e.message, STREAK_ERROR_CODES.INVALID_DATE_RANGE, e.details);
        }
      }
      throw e;
    }

    // Recalculate anchored on the user's local today so the freeze we just
    // inserted is visible even across the UTC boundary. (For the usual case,
    // a shield on yesterday, this is the same day as before: missedDate + 1.)
    const streak = await this.updateEngagementStreak(userId, today);
    return { ...streak, protected_date: targetDate };
  }

  /**
   * Get user's engagement streak details, recalculated from claims.
   */
  static async getEngagementStreak(
    userId: string,
    timezone?: string
  ): Promise<EngagementStreakResponse> {
    const supabaseAdmin = createAdminSupabase();

    const { data: streakRecord, error } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!streakRecord) {
      return {
        current_streak: 0,
        longest_streak: 0,
        freezes_available: DEFAULT_STREAK_FREEZES,
        paused: false,
        pause_end_date: null,
        pause_start_date: null,
        last_engagement_date: null,
      };
    }

    const { data: claims } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', addDays(localToday(), -730))
      .order('claim_date', { ascending: false });

    const claimDates = new Set((claims || []).map(c => c.claim_date));
    const currentStreak = calculateStreak(claimDates, localToday(timezone));

    if (currentStreak !== streakRecord.current_streak) {
      await supabaseAdmin
        .from('engagement_streaks')
        .update({ current_streak: currentStreak })
        .eq('user_id', userId);
      streakRecord.current_streak = currentStreak;
    }

    // Report the live shield inventory (single source of truth), not the
    // mirrored legacy column.
    const response = this.formatStreakResponse(streakRecord);
    try {
      const inventory = await StreakShieldService.getInventory(userId);
      response.freezes_available = inventory.available;
      response.shields_unlimited = inventory.unlimited;
    } catch (e) {
      console.error('[getEngagementStreak] shield inventory error (using mirror):', e);
    }

    // What a shield costs and what the user can spend. `xp_balance` is only
    // known once the spent ledger exists (migration 095); until then it is null.
    const ledger = streakRecord as unknown as { total_points?: number | null; points_spent?: number | null };
    response.shield_price_xp = shieldXpPrice();
    response.xp_balance =
      typeof ledger.points_spent === 'number'
        ? Math.max(0, (ledger.total_points || 0) - ledger.points_spent)
        : null;
    return response;
  }

  // ============================================================================
  // PAUSE MANAGEMENT
  // ============================================================================

  /**
   * Pause streak for up to 90 days (life events). Pausing is free for
   * everyone — freezing streaks for the sick/injured is table stakes, not a
   * premium feature.
   *
   * `timezone` anchors the first paused day on the user's local calendar.
   * Returns the stored pause window.
   */
  static async pauseStreak(
    userId: string,
    resumeDateInput?: string,
    timezone?: string
  ): Promise<{ pause_start_date: string; pause_end_date: string }> {
    const supabaseAdmin = createAdminSupabase();

    const streakRecord = await this.getOrCreateRecord(userId);

    if (streakRecord.paused) {
      throw new StreakError('Streak is already paused', STREAK_ERROR_CODES.ALREADY_PAUSED);
    }

    const pauseStart = localToday(timezone);
    const resumeDate = resumeDateInput
      ? resumeDateInput.slice(0, 10)
      : addDays(pauseStart, MAX_PAUSE_DURATION_DAYS);

    const pauseDurationDays = daysBetween(pauseStart, resumeDate);
    if (pauseDurationDays > MAX_PAUSE_DURATION_DAYS) {
      throw new StreakError(
        `Pause duration cannot exceed ${MAX_PAUSE_DURATION_DAYS} days`,
        STREAK_ERROR_CODES.PAUSE_TOO_LONG,
        { max_days: MAX_PAUSE_DURATION_DAYS, requested_days: pauseDurationDays }
      );
    }
    // `!(x >= 1)` also rejects an unreadable date (NaN) instead of storing it.
    if (!(pauseDurationDays >= 1)) {
      throw new StreakError('Resume date must be in the future', STREAK_ERROR_CODES.INVALID_DATE_RANGE);
    }

    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        paused: true,
        pause_start_date: pauseStart,
        pause_end_date: resumeDate,
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    return { pause_start_date: pauseStart, pause_end_date: resumeDate };
  }

  /**
   * Resume paused streak. The paused gap is bridged with claim rows so the
   * derived calculation doesn't see it as missed days. The bridge rows carry
   * `metadata.source = 'streak_pause'`, which is how the history reports
   * paused days after the pause itself has been cleared.
   */
  static async resumeStreak(userId: string, timezone?: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const { data: streakRecord, error: fetchError } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!streakRecord) throw new Error('Streak record not found');

    if (!streakRecord.paused) {
      throw new StreakError('Streak is not currently paused', STREAK_ERROR_CODES.NOT_PAUSED);
    }

    // Bridge the paused days (pause_start .. yesterday) so the streak
    // survives the pause instead of silently recomputing to 0.
    const today = localToday(timezone);
    if (streakRecord.pause_start_date) {
      const bridgeRows = [];
      for (
        let day = streakRecord.pause_start_date;
        day < today && bridgeRows.length <= MAX_PAUSE_DURATION_DAYS;
        day = addDays(day, 1)
      ) {
        bridgeRows.push({
          user_id: userId,
          claim_date: day,
          claimed_at: new Date().toISOString(),
          claim_method: 'freeze',
          timezone: timezone || 'UTC',
          health_data_synced: false,
          metadata: { source: 'streak_pause' },
        });
      }
      if (bridgeRows.length > 0) {
        const { error: bridgeError } = await supabaseAdmin
          .from('streak_claims')
          .upsert(bridgeRows, { onConflict: 'user_id,claim_date', ignoreDuplicates: true });
        if (bridgeError) console.error('[resumeStreak] bridge insert error:', bridgeError);
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        paused: false,
        pause_start_date: null,
        pause_end_date: null,
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    await this.updateEngagementStreak(userId, today);
  }

  // ============================================================================
  // FREEZE PURCHASE (compat wrapper)
  // ============================================================================

  /**
   * Credit a purchased shield. Charges NOTHING: the caller must already have
   * settled and verified the payment. The purchase route does not use this;
   * it buys with XP through StreakShieldService.purchaseWithXp.
   */
  static async purchaseFreeze(userId: string): Promise<void> {
    const credited = await StreakShieldService.creditPurchased(userId, 1);
    if (credited === 0) {
      throw new StreakError(
        'You already have the maximum number of shields',
        STREAK_ERROR_CODES.NO_FREEZES_AVAILABLE
      );
    }
  }

  // ============================================================================
  // HISTORY & REPORTING
  // ============================================================================

  /**
   * Get last N days of engagement activity
   */
  static async getEngagementHistory(
    userId: string,
    days: number = 90,
    timezone?: string
  ): Promise<EngagementHistoryResponse> {
    const supabaseAdmin = createAdminSupabase();

    const startDate = addDays(localToday(), -days);

    const { data: activities, error } = await supabaseAdmin
      .from('engagement_activities')
      .select('activity_date, activity_type')
      .eq('user_id', userId)
      .gte('activity_date', startDate)
      .order('activity_date', { ascending: false });

    if (error) throw error;

    const activityMap = new Map<string, ActivityType[]>();
    let totalActivities = 0;

    for (const activity of activities || []) {
      const date = activity.activity_date;
      if (!activityMap.has(date)) {
        activityMap.set(date, []);
      }
      activityMap.get(date)!.push(activity.activity_type as ActivityType);
      totalActivities++;
    }

    const entries: EngagementHistoryEntry[] = Array.from(activityMap.entries())
      .map(([date, dayActivities]) => ({
        date,
        activities: dayActivities,
        activity_count: dayActivities.length,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    return {
      entries,
      total_days: entries.length,
      total_activities: totalActivities,
      paused_days: await this.getPausedDays(userId, startDate, timezone),
    };
  }

  /**
   * Days on or after `startDate` on which the streak was paused, ascending.
   *
   * Two sources: the bridge rows resumeStreak writes for a finished pause
   * (`streak_claims.metadata.source = 'streak_pause'`) and, while a pause is
   * running, every day from `pause_start_date` up to the user's today.
   * Never throws: the history is still useful without it.
   */
  static async getPausedDays(userId: string, startDate: string, timezone?: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();
    const days = new Set<string>();

    try {
      const [{ data: bridged, error: bridgedError }, { data: record, error: recordError }] =
        await Promise.all([
          supabaseAdmin
            .from('streak_claims')
            .select('claim_date, claim_method, metadata')
            .eq('user_id', userId)
            .eq('claim_method', 'freeze')
            .gte('claim_date', startDate),
          supabaseAdmin
            .from('engagement_streaks')
            .select('paused, pause_start_date')
            .eq('user_id', userId)
            .maybeSingle(),
        ]);
      if (bridgedError) throw bridgedError;
      if (recordError) throw recordError;

      for (const row of bridged || []) {
        const metadata = row.metadata as { source?: string } | null;
        if (metadata?.source === 'streak_pause') days.add(row.claim_date);
      }

      if (record?.paused && record.pause_start_date) {
        const today = localToday(timezone);
        const first = record.pause_start_date > startDate ? record.pause_start_date : startDate;
        for (
          let day = first, guard = 0;
          day <= today && guard <= 366;
          day = addDays(day, 1), guard++
        ) {
          days.add(day);
        }
      }
    } catch (e) {
      console.error('[EngagementStreakService.getPausedDays] error (returning none):', e);
      return [];
    }

    return Array.from(days).sort();
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private static async getOrCreateRecord(userId: string): Promise<EngagementStreak> {
    const supabaseAdmin = createAdminSupabase();

    const { data: record, error } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (record) return record;

    const { data: newRecord, error: createError } = await supabaseAdmin
      .from('engagement_streaks')
      .insert({
        user_id: userId,
        current_streak: 0,
        longest_streak: 0,
        streak_freezes_available: DEFAULT_STREAK_FREEZES,
        streak_freezes_used_this_week: 0,
      })
      .select()
      .single();

    if (createError) throw createError;
    if (!newRecord) throw new Error('Failed to create streak record');
    return newRecord;
  }

  private static formatStreakResponse(record: EngagementStreak): EngagementStreakResponse {
    return {
      current_streak: record.current_streak,
      longest_streak: record.longest_streak,
      freezes_available: record.streak_freezes_available,
      paused: record.paused,
      pause_end_date: record.pause_end_date,
      pause_start_date: record.paused ? record.pause_start_date ?? null : null,
      last_engagement_date: record.last_engagement_date,
    };
  }
}

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
import { localToday, addDays, daysBetween, calculateStreak } from '../streaks/streak-calculator';

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
    const targetDate = missedDate || addDays(today, -1);

    const diff = daysBetween(targetDate, today);
    if (diff < 1 || diff > 7) {
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

    // Recalculate anchored on the user's local "today" (= missedDate + 1) so
    // the freeze we just inserted is visible even across the UTC boundary.
    return await this.updateEngagementStreak(userId, addDays(targetDate, 1));
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
    return response;
  }

  // ============================================================================
  // PAUSE MANAGEMENT
  // ============================================================================

  /**
   * Pause streak for up to 90 days (life events). Pausing is free for
   * everyone — freezing streaks for the sick/injured is table stakes, not a
   * premium feature.
   */
  static async pauseStreak(userId: string, resumeDateInput?: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    const streakRecord = await this.getOrCreateRecord(userId);

    if (streakRecord.paused) {
      throw new StreakError('Streak is already paused', STREAK_ERROR_CODES.ALREADY_PAUSED);
    }

    const pauseStart = localToday();
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
    if (pauseDurationDays < 1) {
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
  }

  /**
   * Resume paused streak. The paused gap is bridged with claim rows so the
   * derived calculation doesn't see it as missed days.
   */
  static async resumeStreak(userId: string): Promise<void> {
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
    const today = localToday();
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
          timezone: 'UTC',
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

    await this.updateEngagementStreak(userId);
  }

  // ============================================================================
  // FREEZE PURCHASE (compat wrapper)
  // ============================================================================

  /**
   * Credit a purchased shield. Payment/XP settlement happens upstream.
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
    days: number = 90
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
    };
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
      last_engagement_date: record.last_engagement_date,
    };
  }
}

import { createAdminSupabase } from '../supabase-admin';
import {
  EngagementStreak,
  EngagementActivity,
  ActivityType,
  EngagementStreakResponse,
  EngagementHistoryEntry,
  EngagementHistoryResponse,
  PauseStreakInput,
  StreakCalculationResult,
  MAX_STREAK_FREEZES,
  DEFAULT_STREAK_FREEZES,
  FREEZE_RESET_INTERVAL_DAYS,
  FREEZE_EARN_STREAK_DAYS,
  MAX_PAUSE_DURATION_DAYS,
  StreakError,
  STREAK_ERROR_CODES,
} from '../types/streak';

/**
 * EngagementStreakService
 *
 * Manages Tier 1 engagement streaks across all user activities.
 *
 * Business Logic:
 * - Current streak = consecutive days with at least 1 engagement activity
 * - Grace: If miss a day, auto-use 1 freeze (if available)
 * - Freezes: Start with 1, earn 1 per 7-day streak maintained, max 5
 * - Auto-reset: Freezes reset weekly (add 1 every 7 days)
 * - Today (day 0) doesn't break streak even if no activity yet
 * - Pause: Up to 90 days for life events (vacation, illness, etc.)
 */
export class EngagementStreakService {
  // ============================================================================
  // CORE STREAK MANAGEMENT
  // ============================================================================

  /**
   * Record an engagement activity and update streak
   * Called whenever user does something that counts toward engagement
   */
  static async recordActivity(
    userId: string,
    activityType: ActivityType,
    referenceId?: string,
    activityDate?: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const date = activityDate || new Date().toISOString().split('T')[0];

    console.log(`[EngagementStreakService.recordActivity] Recording ${activityType} for user ${userId} on ${date}`);

    try {
      // Insert activity (idempotent - will ignore if duplicate)
      const { error: insertError } = await supabaseAdmin
        .from('engagement_activities')
        .insert({
          user_id: userId,
          activity_date: date,
          activity_type: activityType,
          reference_id: referenceId || null,
        });

      // Ignore duplicate key errors (PGRST116 or 23505)
      if (insertError && insertError.code !== 'PGRST116' && insertError.code !== '23505') {
        console.error(`[EngagementStreakService.recordActivity] Error inserting activity:`, insertError);
        throw insertError;
      }

      // Update engagement streak
      await this.updateEngagementStreak(userId);

      console.log(`[EngagementStreakService.recordActivity] Successfully recorded activity and updated streak`);
    } catch (error) {
      console.error(`[EngagementStreakService.recordActivity] Error:`, error);
      throw error;
    }
  }

  /**
   * Calculate and update engagement streak with grace logic
   * Returns current streak, longest streak, freezes available
   */
  static async updateEngagementStreak(userId: string): Promise<EngagementStreakResponse> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[EngagementStreakService.updateEngagementStreak] Updating streak for user ${userId}`);

    // Get or create engagement streak record
    let { data: streakRecord, error: fetchError } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError && fetchError.code === 'PGRST116') {
      // No record exists, create one
      console.log(`[EngagementStreakService.updateEngagementStreak] Creating new streak record`);

      const { data: newRecord, error: createError } = await supabaseAdmin
        .from('engagement_streaks')
        .insert({
          user_id: userId,
          current_streak: 0,
          longest_streak: 0,
          streak_freezes_available: DEFAULT_STREAK_FREEZES,
          streak_freezes_used_this_week: 0,
          auto_freeze_reset_date: this.calculateNextResetDate(new Date()),
        })
        .select()
        .single();

      if (createError) throw createError;
      streakRecord = newRecord;
    } else if (fetchError) {
      throw fetchError;
    }

    if (!streakRecord) {
      throw new Error('Failed to get or create streak record');
    }

    // If paused, don't update streak
    if (streakRecord.paused) {
      console.log(`[EngagementStreakService.updateEngagementStreak] Streak is paused, skipping update`);
      return this.formatStreakResponse(streakRecord);
    }

    // Check if weekly freeze reset is due
    await this.checkAndResetWeeklyFreezes(userId, streakRecord);

    // Get recent activities (last 90 days)
    const { data: activities, error: activitiesError } = await supabaseAdmin
      .from('engagement_activities')
      .select('activity_date')
      .eq('user_id', userId)
      .gte('activity_date', this.formatDate(this.getDaysAgo(90)))
      .order('activity_date', { ascending: false });

    if (activitiesError) throw activitiesError;

    // Calculate streak with grace logic
    const calculation = this.calculateStreakWithGrace(
      activities || [],
      streakRecord.streak_freezes_available,
      streakRecord.last_engagement_date
    );

    console.log(`[EngagementStreakService.updateEngagementStreak] Calculation result:`, calculation);

    // Check if user earned a new freeze (every 7 days of streak)
    const newFreezesEarned = this.calculateFreezesEarned(
      calculation.current_streak,
      streakRecord.current_streak
    );

    const updatedFreezesAvailable = Math.min(
      MAX_STREAK_FREEZES,
      streakRecord.streak_freezes_available - calculation.freezes_used + newFreezesEarned
    );

    // Get last engagement date from activities
    const lastEngagementDate = activities && activities.length > 0
      ? activities[0].activity_date
      : streakRecord.last_engagement_date;

    // Update streak record
    // longest_streak is the MAX of (current_streak, existing longest_streak)
    // This ensures we only update longest_streak when current streak exceeds it
    const newLongestStreak = Math.max(calculation.current_streak, streakRecord.longest_streak);

    console.log(`[EngagementStreakService.updateEngagementStreak] Updating: current=${calculation.current_streak}, longest=${newLongestStreak} (was ${streakRecord.longest_streak})`);

    const { data: updatedStreak, error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        current_streak: calculation.current_streak,
        longest_streak: newLongestStreak,
        last_engagement_date: lastEngagementDate,
        streak_freezes_available: updatedFreezesAvailable,
        streak_freezes_used_this_week: streakRecord.streak_freezes_used_this_week + calculation.freezes_used,
      })
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) throw updateError;
    if (!updatedStreak) throw new Error('Failed to update streak');

    console.log(`[EngagementStreakService.updateEngagementStreak] Updated streak: ${calculation.current_streak} days, ${updatedFreezesAvailable} freezes available`);

    return this.formatStreakResponse(updatedStreak);
  }

  /**
   * Get user's engagement streak details
   */
  static async getEngagementStreak(userId: string): Promise<EngagementStreakResponse> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[EngagementStreakService.getEngagementStreak] Fetching streak for user ${userId}`);

    const { data: streakRecord, error } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No streak record exists, return default
      console.log(`[EngagementStreakService.getEngagementStreak] No streak record found, returning defaults`);
      return {
        current_streak: 0,
        longest_streak: 0,
        freezes_available: DEFAULT_STREAK_FREEZES,
        paused: false,
        pause_end_date: null,
        last_engagement_date: null,
      };
    }

    if (error) throw error;
    if (!streakRecord) throw new Error('Streak record not found');

    return this.formatStreakResponse(streakRecord);
  }

  // ============================================================================
  // PAUSE MANAGEMENT
  // ============================================================================

  /**
   * Pause streak for up to 90 days (life events)
   */
  static async pauseStreak(userId: string, resumeDateInput?: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[EngagementStreakService.pauseStreak] Pausing streak for user ${userId}`);

    // Get current streak
    const { data: streakRecord, error: fetchError } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError) throw fetchError;
    if (!streakRecord) throw new Error('Streak record not found');

    // Check if already paused
    if (streakRecord.paused) {
      throw new StreakError(
        'Streak is already paused',
        STREAK_ERROR_CODES.ALREADY_PAUSED
      );
    }

    // Calculate resume date
    const pauseStartDate = new Date();
    const resumeDate = resumeDateInput
      ? new Date(resumeDateInput)
      : new Date(pauseStartDate.getTime() + MAX_PAUSE_DURATION_DAYS * 24 * 60 * 60 * 1000);

    // Validate pause duration
    const pauseDurationDays = Math.floor(
      (resumeDate.getTime() - pauseStartDate.getTime()) / (24 * 60 * 60 * 1000)
    );

    if (pauseDurationDays > MAX_PAUSE_DURATION_DAYS) {
      throw new StreakError(
        `Pause duration cannot exceed ${MAX_PAUSE_DURATION_DAYS} days`,
        STREAK_ERROR_CODES.PAUSE_TOO_LONG,
        { max_days: MAX_PAUSE_DURATION_DAYS, requested_days: pauseDurationDays }
      );
    }

    // Update streak record
    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        paused: true,
        pause_start_date: this.formatDate(pauseStartDate),
        pause_end_date: this.formatDate(resumeDate),
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    console.log(`[EngagementStreakService.pauseStreak] Streak paused until ${resumeDate.toISOString()}`);
  }

  /**
   * Resume paused streak
   */
  static async resumeStreak(userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[EngagementStreakService.resumeStreak] Resuming streak for user ${userId}`);

    // Get current streak
    const { data: streakRecord, error: fetchError } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError) throw fetchError;
    if (!streakRecord) throw new Error('Streak record not found');

    // Check if paused
    if (!streakRecord.paused) {
      throw new StreakError(
        'Streak is not currently paused',
        STREAK_ERROR_CODES.NOT_PAUSED
      );
    }

    // Resume streak
    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        paused: false,
        pause_start_date: null,
        pause_end_date: null,
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    console.log(`[EngagementStreakService.resumeStreak] Streak resumed`);

    // Recalculate streak
    await this.updateEngagementStreak(userId);
  }

  // ============================================================================
  // FREEZE PURCHASE
  // ============================================================================

  /**
   * Purchase additional streak freezes (100 XP or $0.99)
   * This is a placeholder - actual payment/XP logic would go here
   */
  static async purchaseFreeze(userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[EngagementStreakService.purchaseFreeze] User ${userId} purchasing freeze`);

    // Get current streak
    const { data: streakRecord, error: fetchError } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError) throw fetchError;
    if (!streakRecord) throw new Error('Streak record not found');

    // Check if at max
    if (streakRecord.streak_freezes_available >= MAX_STREAK_FREEZES) {
      throw new StreakError(
        `You already have the maximum of ${MAX_STREAK_FREEZES} freezes`,
        STREAK_ERROR_CODES.NO_FREEZES_AVAILABLE,
        { max_freezes: MAX_STREAK_FREEZES }
      );
    }

    // TODO: Implement payment/XP deduction logic here
    // For now, just add the freeze

    // Update streak record
    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        streak_freezes_available: streakRecord.streak_freezes_available + 1,
      })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    console.log(`[EngagementStreakService.purchaseFreeze] Freeze purchased successfully`);
  }

  // ============================================================================
  // HISTORY & REPORTING
  // ============================================================================

  /**
   * Get last 90 days of engagement activity
   */
  static async getEngagementHistory(
    userId: string,
    days: number = 90
  ): Promise<EngagementHistoryResponse> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[EngagementStreakService.getEngagementHistory] Fetching ${days} days for user ${userId}`);

    const startDate = this.formatDate(this.getDaysAgo(days));

    const { data: activities, error } = await supabaseAdmin
      .from('engagement_activities')
      .select('activity_date, activity_type')
      .eq('user_id', userId)
      .gte('activity_date', startDate)
      .order('activity_date', { ascending: false });

    if (error) throw error;

    // Group activities by date
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

    // Convert to array
    const entries: EngagementHistoryEntry[] = Array.from(activityMap.entries())
      .map(([date, activities]) => ({
        date,
        activities,
        activity_count: activities.length,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    console.log(`[EngagementStreakService.getEngagementHistory] Found ${entries.length} days with ${totalActivities} total activities`);

    return {
      entries,
      total_days: entries.length,
      total_activities: totalActivities,
    };
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate streak with grace logic
   *
   * NOTE: This function ONLY calculates current_streak.
   * longest_streak is maintained separately in the database and updated
   * only when current_streak exceeds it.
   */
  private static calculateStreakWithGrace(
    activities: Array<{ activity_date: string }>,
    freezesAvailable: number,
    lastEngagementDate: string | null
  ): StreakCalculationResult {
    const activityDates = new Set(activities.map(a => a.activity_date));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    let freezesUsed = 0;
    let streakBroken = false;

    // Count backwards from today to calculate current streak only
    for (let i = 0; i < 90; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const checkDateStr = this.formatDate(checkDate);

      const hasActivity = activityDates.has(checkDateStr);

      if (hasActivity) {
        // Activity found, increment streak
        currentStreak++;
      } else if (i === 0) {
        // Today with no activity doesn't break streak
        continue;
      } else {
        // Missed a day - try to use a freeze
        if (freezesAvailable - freezesUsed > 0) {
          // Use a freeze to maintain streak
          freezesUsed++;
          currentStreak++;
          console.log(`[calculateStreakWithGrace] Used freeze for ${checkDateStr}, freezes used: ${freezesUsed}`);
        } else {
          // No freezes available, streak broken
          streakBroken = true;
          console.log(`[calculateStreakWithGrace] Streak broken at ${checkDateStr}, no freezes available`);
          break;
        }
      }
    }

    return {
      current_streak: currentStreak,
      longest_streak: 0, // No longer calculated here - maintained in database
      freezes_used: freezesUsed,
      streak_broken: streakBroken,
    };
  }

  /**
   * Calculate how many freezes were earned since last streak value
   */
  private static calculateFreezesEarned(newStreak: number, oldStreak: number): number {
    // Earn 1 freeze for every 7-day milestone crossed
    const oldMilestones = Math.floor(oldStreak / FREEZE_EARN_STREAK_DAYS);
    const newMilestones = Math.floor(newStreak / FREEZE_EARN_STREAK_DAYS);

    const earned = Math.max(0, newMilestones - oldMilestones);

    if (earned > 0) {
      console.log(`[calculateFreezesEarned] Earned ${earned} freeze(s) for reaching ${newStreak} day streak`);
    }

    return earned;
  }

  /**
   * Check if weekly freeze reset is due and apply it
   */
  private static async checkAndResetWeeklyFreezes(
    userId: string,
    streakRecord: EngagementStreak
  ): Promise<void> {
    const today = new Date();
    const resetDate = streakRecord.auto_freeze_reset_date
      ? new Date(streakRecord.auto_freeze_reset_date)
      : null;

    if (!resetDate || today >= resetDate) {
      console.log(`[checkAndResetWeeklyFreezes] Weekly freeze reset due for user ${userId}`);

      const supabaseAdmin = createAdminSupabase();

      // Add 1 freeze (up to max)
      const newFreezes = Math.min(
        MAX_STREAK_FREEZES,
        streakRecord.streak_freezes_available + 1
      );

      // Set next reset date
      const nextResetDate = this.calculateNextResetDate(today);

      await supabaseAdmin
        .from('engagement_streaks')
        .update({
          streak_freezes_available: newFreezes,
          streak_freezes_used_this_week: 0,
          auto_freeze_reset_date: nextResetDate,
        })
        .eq('user_id', userId);

      console.log(`[checkAndResetWeeklyFreezes] Reset freezes to ${newFreezes}, next reset: ${nextResetDate}`);
    }
  }

  /**
   * Calculate next weekly reset date (7 days from now)
   */
  private static calculateNextResetDate(from: Date): string {
    const nextReset = new Date(from);
    nextReset.setDate(nextReset.getDate() + FREEZE_RESET_INTERVAL_DAYS);
    return this.formatDate(nextReset);
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private static formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get date N days ago
   */
  private static getDaysAgo(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  /**
   * Format streak record for API response
   */
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

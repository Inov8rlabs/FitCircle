/**
 * StreakClaimingService
 *
 * Manages explicit and retroactive streak claiming with the following mechanics:
 * - Explicit "Claim Streak" button/API call
 * - Automatic claim when user manually enters data (weight, mood, energy)
 * - 7-day retroactive claiming window
 * - Timezone-aware with 3am grace period
 * - Freeze system (1 free/week, earn more at milestones, max 5)
 * - Recovery mechanics (Weekend Warrior Pass, Milestone Shields, Purchased Resurrection)
 */

import { createAdminSupabase } from '../supabase-admin';
import { EngagementStreakService } from './engagement-streak-service';
import {
  StreakClaim,
  StreakShield,
  StreakRecovery,
  ClaimResult,
  CanClaimResult,
  ClaimableDay,
  ShieldStatus,
  RecoveryInfo,
  ClaimStreakInput,
  ActivateFreezeInput,
  StartRecoveryInput,
  HealthDataCheck,
  StreakBreakCheck,
  RecoveryOption,
  MilestoneInfo,
  StreakClaimError,
  CLAIM_ERROR_CODES,
  CLAIMING_CONSTANTS,
  isWithinRetroactiveWindow,
  isWithinGracePeriod,
  getNextFreezeReset,
  formatDateYYYYMMDD,
  getMilestoneInfo,
} from '../types/streak-claiming';

export class StreakClaimingService {
  // ============================================================================
  // CORE CLAIMING LOGIC
  // ============================================================================

  /**
   * Claim a streak for a specific date (today or retroactive)
   */
  static async claimStreak(
    userId: string,
    claimDate: Date,
    timezone: string,
    method: 'explicit' | 'manual_entry' | 'retroactive'
  ): Promise<ClaimResult> {
    const supabaseAdmin = createAdminSupabase();
    const claimDateStr = formatDateYYYYMMDD(claimDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log(
      `[StreakClaimingService.claimStreak] User ${userId} claiming ${claimDateStr} via ${method}`
    );

    // 1. Validate claim is allowed
    const canClaimResult = await this.canClaimStreak(userId, claimDate, timezone);
    if (!canClaimResult.canClaim) {
      throw new StreakClaimError(
        canClaimResult.reason || 'Cannot claim streak',
        CLAIM_ERROR_CODES.NO_HEALTH_DATA,
        { date: claimDateStr, reason: canClaimResult.reason }
      );
    }

    // 2. Check if already claimed
    if (canClaimResult.alreadyClaimed) {
      throw new StreakClaimError(
        'Streak already claimed for this date',
        CLAIM_ERROR_CODES.ALREADY_CLAIMED,
        { date: claimDateStr }
      );
    }

    // 3. Check for health data
    const healthCheck = await this.checkHealthData(userId, claimDateStr);

    // 4. Insert claim record
    const { data: claim, error: claimError } = await supabaseAdmin
      .from('streak_claims')
      .insert({
        user_id: userId,
        claim_date: claimDateStr,
        claimed_at: new Date().toISOString(),
        claim_method: method,
        timezone,
        health_data_synced: healthCheck.hasAnyData,
        metadata: {
          health_data: {
            has_weight: healthCheck.hasWeight,
            has_steps: healthCheck.hasSteps,
            has_mood: healthCheck.hasMood,
            has_energy: healthCheck.hasEnergy,
          },
        },
      })
      .select()
      .single();

    if (claimError) {
      console.error('[StreakClaimingService.claimStreak] Error inserting claim:', claimError);
      throw claimError;
    }

    // 5. Record engagement activity
    await EngagementStreakService.recordActivity(
      userId,
      'weight_log', // Generic activity type for streak claim
      claim.id,
      claimDateStr
    );

    // 6. Update engagement streak record
    const streakResponse = await EngagementStreakService.updateEngagementStreak(userId);

    // 7. Update last_claim_date in engagement_streaks
    // First fetch current total_claims, then increment
    const { data: currentStreak } = await supabaseAdmin
      .from('engagement_streaks')
      .select('total_claims')
      .eq('user_id', userId)
      .single();

    await supabaseAdmin
      .from('engagement_streaks')
      .update({
        last_claim_date: claimDateStr,
        total_claims: (currentStreak?.total_claims || 0) + 1,
      })
      .eq('user_id', userId);

    // 8. Check for milestone shields
    const milestone = getMilestoneInfo(streakResponse.current_streak);
    if (milestone) {
      await this.grantMilestoneShields(userId, milestone.shieldsGranted || 0);
    }

    console.log(
      `[StreakClaimingService.claimStreak] Successfully claimed streak for ${claimDateStr}, current streak: ${streakResponse.current_streak}`
    );

    return {
      success: true,
      streakCount: streakResponse.current_streak,
      milestone,
      message: `Streak claimed! Current streak: ${streakResponse.current_streak} days`,
      claim,
    };
  }

  /**
   * Check if user can claim a streak for a specific date
   */
  static async canClaimStreak(
    userId: string,
    date: Date,
    timezone: string
  ): Promise<CanClaimResult> {
    const supabaseAdmin = createAdminSupabase();
    const dateStr = formatDateYYYYMMDD(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // 1. Check if date is in the future
    if (date > today) {
      return {
        canClaim: false,
        alreadyClaimed: false,
        reason: 'Cannot claim future dates',
      };
    }

    // 2. Check if within retroactive window (7 days)
    if (!isWithinRetroactiveWindow(date, today)) {
      return {
        canClaim: false,
        alreadyClaimed: false,
        reason: 'Date is outside 7-day retroactive claiming window',
      };
    }

    // 3. Check if already claimed
    const { data: existingClaim } = await supabaseAdmin
      .from('streak_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_date', dateStr)
      .single();

    if (existingClaim) {
      return {
        canClaim: false,
        alreadyClaimed: true,
        reason: 'Already claimed for this date',
      };
    }

    // 4. Check for health data
    const healthCheck = await this.checkHealthData(userId, dateStr);
    if (!healthCheck.hasAnyData) {
      return {
        canClaim: false,
        alreadyClaimed: false,
        hasHealthData: false,
        reason: 'No health data available for this date',
      };
    }

    // 5. Special handling for yesterday - check grace period
    const gracePeriodActive = isWithinGracePeriod(timezone);
    const isYesterday = dateStr === formatDateYYYYMMDD(yesterday);

    return {
      canClaim: true,
      alreadyClaimed: false,
      hasHealthData: true,
      gracePeriodActive: isYesterday ? gracePeriodActive : undefined,
    };
  }

  /**
   * Get claimable days for the last 7 days
   */
  static async getClaimableDays(userId: string, timezone: string): Promise<ClaimableDay[]> {
    const supabaseAdmin = createAdminSupabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days: ClaimableDay[] = [];

    // Get claims for last 7 days
    const { data: claims } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', formatDateYYYYMMDD(new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)));

    const claimedDates = new Set(claims?.map((c) => c.claim_date) || []);

    // Check each of the last 7 days
    for (let i = 0; i <= 7; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = formatDateYYYYMMDD(checkDate);

      const claimed = claimedDates.has(dateStr);
      const healthCheck = await this.checkHealthData(userId, dateStr);
      const canClaimResult = await this.canClaimStreak(userId, checkDate, timezone);

      days.push({
        date: dateStr,
        claimed,
        hasHealthData: healthCheck.hasAnyData,
        canClaim: canClaimResult.canClaim && !claimed,
        reason: canClaimResult.reason,
      });
    }

    return days.sort((a, b) => b.date.localeCompare(a.date));
  }

  // ============================================================================
  // SHIELD MANAGEMENT
  // ============================================================================

  /**
   * Get user's available shields by type
   */
  static async getAvailableShields(userId: string): Promise<ShieldStatus> {
    const supabaseAdmin = createAdminSupabase();

    const { data: shields } = await supabaseAdmin
      .from('streak_shields')
      .select('*')
      .eq('user_id', userId);

    const freezeShield = shields?.find((s) => s.shield_type === 'freeze');
    const milestoneShield = shields?.find((s) => s.shield_type === 'milestone_shield');
    const purchasedShield = shields?.find((s) => s.shield_type === 'purchased');

    const freezes = freezeShield?.available_count || 0;
    const milestones = milestoneShield?.available_count || 0;
    const purchased = purchasedShield?.available_count || 0;

    return {
      freezes,
      milestone_shields: milestones,
      purchased,
      total: freezes + milestones + purchased,
      last_freeze_reset: freezeShield?.last_reset_at || null,
      next_freeze_reset: freezeShield?.last_reset_at
        ? getNextFreezeReset(new Date(freezeShield.last_reset_at)).toISOString()
        : getNextFreezeReset().toISOString(),
    };
  }

  /**
   * Activate a freeze shield for a specific date
   */
  static async activateFreeze(userId: string, date: Date): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();
    const dateStr = formatDateYYYYMMDD(date);

    console.log(`[StreakClaimingService.activateFreeze] User ${userId} activating freeze for ${dateStr}`);

    // Check available shields
    const shields = await this.getAvailableShields(userId);
    if (shields.total === 0) {
      throw new StreakClaimError(
        'No shields available',
        CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE
      );
    }

    // Use shields in priority order: freeze > milestone > purchased
    let shieldType: 'freeze' | 'milestone_shield' | 'purchased';
    if (shields.freezes > 0) {
      shieldType = 'freeze';
    } else if (shields.milestone_shields > 0) {
      shieldType = 'milestone_shield';
    } else {
      shieldType = 'purchased';
    }

    // Decrement shield count - using direct update instead of RPC
    // Table structure: one row per user per shield_type with available_count
    const { data: shieldRow, error: fetchError } = await supabaseAdmin
      .from('streak_shields')
      .select('available_count')
      .eq('user_id', userId)
      .eq('shield_type', shieldType)
      .single();

    if (fetchError) {
      console.error('[StreakClaimingService.activateFreeze] Error fetching shield:', fetchError);
      throw fetchError;
    }

    if (shieldRow && shieldRow.available_count > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('streak_shields')
        .update({ available_count: shieldRow.available_count - 1 })
        .eq('user_id', userId)
        .eq('shield_type', shieldType);

      if (updateError) {
        console.error('[StreakClaimingService.activateFreeze] Error decrementing shield:', updateError);
        throw updateError;
      }
    }

    // Record engagement activity for the protected day
    await EngagementStreakService.recordActivity(
      userId,
      'weight_log',
      undefined,
      dateStr
    );

    console.log(`[StreakClaimingService.activateFreeze] Successfully activated ${shieldType} for ${dateStr}`);

    return true;
  }

  /**
   * Reset weekly free freezes (called by cron job on Mondays)
   */
  static async resetWeeklyFreezes(): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log('[StreakClaimingService.resetWeeklyFreezes] Resetting weekly freezes');

    // Fetch all freeze shields
    const { data: shields, error: fetchError } = await supabaseAdmin
      .from('streak_shields')
      .select('id, available_count')
      .eq('shield_type', 'freeze');

    if (fetchError) {
      console.error('[StreakClaimingService.resetWeeklyFreezes] Error fetching shields:', fetchError);
      throw fetchError;
    }

    // Update each shield: increment by 1, cap at max
    const updatePromises = (shields || []).map((shield) => {
      const newCount = Math.min(
        CLAIMING_CONSTANTS.MAX_TOTAL_SHIELDS,
        shield.available_count + 1
      );

      return supabaseAdmin
        .from('streak_shields')
        .update({
          available_count: newCount,
          last_reset_at: new Date().toISOString(),
        })
        .eq('id', shield.id);
    });

    const results = await Promise.all(updatePromises);
    const errors = results.filter((r) => r.error);

    if (errors.length > 0) {
      console.error('[StreakClaimingService.resetWeeklyFreezes] Errors updating shields:', errors);
      throw new Error(`Failed to update ${errors.length} shields`);
    }

    console.log(`[StreakClaimingService.resetWeeklyFreezes] Successfully reset ${shields?.length || 0} freeze shields`);
  }

  /**
   * Grant milestone shields when user reaches milestone streaks
   */
  static async grantMilestoneShields(userId: string, count: number): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[StreakClaimingService.grantMilestoneShields] Granting ${count} shields to user ${userId}`);

    // Get current milestone shields
    const { data: shield } = await supabaseAdmin
      .from('streak_shields')
      .select('available_count')
      .eq('user_id', userId)
      .eq('shield_type', 'milestone_shield')
      .single();

    const currentCount = shield?.available_count || 0;
    const newCount = Math.min(CLAIMING_CONSTANTS.MAX_TOTAL_SHIELDS, currentCount + count);

    // Update milestone shield count
    // Use upsert with onConflict to handle both insert and update cases
    const { error } = await supabaseAdmin
      .from('streak_shields')
      .upsert(
        {
          user_id: userId,
          shield_type: 'milestone_shield',
          available_count: newCount,
        },
        { onConflict: 'user_id,shield_type' }
      );

    if (error) {
      console.error('[StreakClaimingService.grantMilestoneShields] Error:', error);
      throw error;
    }

    console.log(`[StreakClaimingService.grantMilestoneShields] Successfully granted shields`);
  }

  // ============================================================================
  // RECOVERY SYSTEM
  // ============================================================================

  /**
   * Start a recovery attempt (Weekend Warrior or Purchased)
   */
  static async startRecovery(
    userId: string,
    brokenDate: Date,
    type: 'weekend_warrior' | 'purchased'
  ): Promise<RecoveryInfo> {
    const supabaseAdmin = createAdminSupabase();
    const brokenDateStr = formatDateYYYYMMDD(brokenDate);

    console.log(`[StreakClaimingService.startRecovery] User ${userId} starting ${type} recovery for ${brokenDateStr}`);

    // Check if recovery already exists
    const { data: existing } = await supabaseAdmin
      .from('streak_recoveries')
      .select('*')
      .eq('user_id', userId)
      .eq('broken_date', brokenDateStr)
      .single();

    if (existing) {
      if (existing.recovery_status === 'pending') {
        throw new StreakClaimError(
          'Recovery already in progress',
          CLAIM_ERROR_CODES.RECOVERY_IN_PROGRESS
        );
      }
    }

    // Set up recovery parameters
    let actionsRequired: number | null = null;
    let expiresAt: Date | null = null;

    if (type === 'weekend_warrior') {
      actionsRequired = CLAIMING_CONSTANTS.WEEKEND_WARRIOR_ACTIONS;
      expiresAt = new Date(Date.now() + CLAIMING_CONSTANTS.WEEKEND_WARRIOR_WINDOW_HOURS * 60 * 60 * 1000);
    }
    // For purchased, no actions required - immediate recovery

    // Insert recovery record
    const { data: recovery, error } = await supabaseAdmin
      .from('streak_recoveries')
      .insert({
        user_id: userId,
        broken_date: brokenDateStr,
        recovery_type: type,
        recovery_status: type === 'purchased' ? 'completed' : 'pending',
        actions_required: actionsRequired,
        actions_completed: 0,
        expires_at: expiresAt?.toISOString(),
        completed_at: type === 'purchased' ? new Date().toISOString() : null,
        metadata: {
          started_at: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (error) {
      console.error('[StreakClaimingService.startRecovery] Error:', error);
      throw error;
    }

    // If purchased, restore the streak immediately
    if (type === 'purchased') {
      await EngagementStreakService.recordActivity(userId, 'weight_log', recovery.id, brokenDateStr);
    }

    const actionsRemaining = actionsRequired ? actionsRequired - 0 : 0;

    console.log(`[StreakClaimingService.startRecovery] Successfully started ${type} recovery`);

    return {
      recovery,
      actionsRemaining,
      timeRemaining: expiresAt ? expiresAt.toISOString() : undefined,
    };
  }

  /**
   * Complete a recovery action (for Weekend Warrior Pass)
   */
  static async completeRecoveryAction(userId: string, recoveryId: string): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`[StreakClaimingService.completeRecoveryAction] User ${userId} completing action for ${recoveryId}`);

    // Get recovery record
    const { data: recovery } = await supabaseAdmin
      .from('streak_recoveries')
      .select('*')
      .eq('id', recoveryId)
      .eq('user_id', userId)
      .single();

    if (!recovery) {
      throw new StreakClaimError('Recovery not found', CLAIM_ERROR_CODES.RECOVERY_EXPIRED);
    }

    if (recovery.recovery_status !== 'pending') {
      throw new StreakClaimError(
        'Recovery is not in pending status',
        CLAIM_ERROR_CODES.RECOVERY_EXPIRED
      );
    }

    // Check if expired
    if (recovery.expires_at && new Date(recovery.expires_at) < new Date()) {
      await supabaseAdmin
        .from('streak_recoveries')
        .update({ recovery_status: 'expired' })
        .eq('id', recoveryId);

      throw new StreakClaimError('Recovery window expired', CLAIM_ERROR_CODES.RECOVERY_EXPIRED);
    }

    // Increment actions completed
    const newActionsCompleted = recovery.actions_completed + 1;
    const isComplete = newActionsCompleted >= (recovery.actions_required || 0);

    await supabaseAdmin
      .from('streak_recoveries')
      .update({
        actions_completed: newActionsCompleted,
        recovery_status: isComplete ? 'completed' : 'pending',
        completed_at: isComplete ? new Date().toISOString() : null,
      })
      .eq('id', recoveryId);

    // If complete, restore the streak
    if (isComplete) {
      await EngagementStreakService.recordActivity(
        userId,
        'weight_log',
        recoveryId,
        recovery.broken_date
      );
    }

    console.log(
      `[StreakClaimingService.completeRecoveryAction] Action completed (${newActionsCompleted}/${recovery.actions_required})`
    );

    return isComplete;
  }

  // ============================================================================
  // HEALTH DATA & SYNC INTEGRATION
  // ============================================================================

  /**
   * Check if health data exists for a specific date
   */
  static async checkHealthData(userId: string, date: string): Promise<HealthDataCheck> {
    const supabaseAdmin = createAdminSupabase();

    const { data, error } = await supabaseAdmin
      .from('daily_tracking')
      .select('weight_kg, steps, mood_score, energy_level')
      .eq('user_id', userId)
      .eq('tracking_date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is expected for no data
      console.error(`[checkHealthData] Error querying daily_tracking for ${date}:`, error);
    }

    const hasWeight = !!data?.weight_kg && data.weight_kg > 0;
    const hasSteps = !!data?.steps && data.steps > 0;
    const hasMood = !!data?.mood_score;
    const hasEnergy = !!data?.energy_level;

    console.log(`[checkHealthData] User ${userId}, date ${date}: weight=${hasWeight}, steps=${hasSteps}, mood=${hasMood}, energy=${hasEnergy}`);

    return {
      hasWeight,
      hasSteps,
      hasMood,
      hasEnergy,
      hasAnyData: hasWeight || hasSteps || hasMood || hasEnergy,
    };
  }

  /**
   * Sync health data without automatically claiming streak
   * Used by HealthKit/Google Fit auto-sync
   */
  static async syncHealthDataWithoutClaim(
    userId: string,
    data: Array<{ date: string; steps?: number; weight?: number }>
  ): Promise<void> {
    // This method is just a marker - actual sync is handled by existing bulk-sync endpoint
    // The key is that bulk-sync should NOT call claimStreak() automatically
    console.log(
      `[StreakClaimingService.syncHealthDataWithoutClaim] Synced ${data.length} days for user ${userId}`
    );
  }

  // ============================================================================
  // STREAK CALCULATION & CHECKING
  // ============================================================================

  /**
   * Calculate user's current streak based on claims
   */
  static async calculateCurrentStreak(userId: string): Promise<number> {
    const supabaseAdmin = createAdminSupabase();

    // Get all claims ordered by date descending
    const { data: claims } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .order('claim_date', { ascending: false })
      .limit(365); // Only check last year

    if (!claims || claims.length === 0) {
      return 0;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streak = 0;
    let currentDate = today;

    for (const claim of claims) {
      const claimDate = new Date(claim.claim_date);
      claimDate.setHours(0, 0, 0, 0);

      const daysDiff = Math.floor(
        (currentDate.getTime() - claimDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      if (daysDiff === 0 || daysDiff === 1) {
        streak++;
        currentDate = claimDate;
      } else {
        break; // Streak is broken
      }
    }

    return streak;
  }

  /**
   * Check if streak is broken and handle auto-shields
   * Called by daily cron job
   */
  static async checkAndBreakStreak(userId: string): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatDateYYYYMMDD(yesterday);

    // Check if user claimed yesterday
    const { data: yesterdayClaim } = await supabaseAdmin
      .from('streak_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('claim_date', yesterdayStr)
      .single();

    if (yesterdayClaim) {
      return false; // Streak not broken
    }

    // Check if user has available shields
    const shields = await this.getAvailableShields(userId);
    if (shields.total > 0) {
      // Auto-apply shield
      await this.activateFreeze(userId, yesterday);
      console.log(`[StreakClaimingService.checkAndBreakStreak] Auto-applied shield for user ${userId}`);
      return false;
    }

    // Streak is broken - reset
    await supabaseAdmin
      .from('engagement_streaks')
      .update({
        current_streak: 0,
      })
      .eq('user_id', userId);

    console.log(`[StreakClaimingService.checkAndBreakStreak] Streak broken for user ${userId}`);
    return true;
  }
}

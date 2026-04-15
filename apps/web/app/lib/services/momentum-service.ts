import { createAdminSupabase } from '../supabase-admin';

// ============================================================================
// TYPES
// ============================================================================

export interface MomentumStatus {
  current_momentum: number;
  best_momentum: number;
  flame_level: number;
  flame_label: string;
  grace_day_available: boolean;
  grace_day_used_this_week: boolean;
  next_milestone: MomentumMilestone | null;
  days_to_next_milestone: number | null;
  last_check_in_date: string | null;
  checked_in_today: boolean;
}

export interface MomentumMilestone {
  days: number;
  name: string;
  description: string;
  badge: string;
  unlocked: boolean;
  unlocked_at?: string;
}

export interface MomentumCheckInResult {
  new_momentum: number;
  best_momentum: number;
  flame_level: number;
  flame_label: string;
  is_first_check_in_today: boolean;
  milestone_achieved: MomentumMilestone | null;
  grace_day_available: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MILESTONES: Omit<MomentumMilestone, 'unlocked' | 'unlocked_at'>[] = [
  { days: 3, name: '3-Day Spark', description: 'Your momentum is building!', badge: '🔥' },
  { days: 7, name: '1-Week Flame', description: 'One week of momentum!', badge: '💪' },
  { days: 14, name: '2-Week Blaze', description: 'Two weeks strong!', badge: '🏆' },
  { days: 30, name: 'Monthly Inferno', description: 'A full month of fire!', badge: '🎖️' },
  { days: 60, name: '60-Day Furnace', description: 'Unstoppable heat!', badge: '⭐' },
  { days: 100, name: 'Centurion Flame', description: 'The elite 100-day fire!', badge: '👑' },
  { days: 365, name: 'Eternal Flame', description: 'A full year of momentum!', badge: '🏅' },
];

// Milestone day values for protection check
const MILESTONE_DAYS = MILESTONES.map(m => m.days);

const FLAME_LEVELS: { min: number; max: number; level: number; label: string }[] = [
  { min: 0, max: 6, level: 1, label: 'Spark' },
  { min: 7, max: 13, level: 2, label: 'Flame' },
  { min: 14, max: 29, level: 3, label: 'Blaze' },
  { min: 30, max: 99, level: 4, label: 'Inferno' },
  { min: 100, max: Infinity, level: 5, label: 'Eternal' },
];

// ============================================================================
// SERVICE
// ============================================================================

export class MomentumService {
  // ============================================================================
  // CORE: CHECK-IN
  // ============================================================================

  /**
   * Perform a momentum check-in for the user.
   * Idempotent: duplicate same-day check-ins are no-ops.
   */
  static async checkIn(userId: string): Promise<MomentumCheckInResult> {
    const supabaseAdmin = createAdminSupabase();
    const today = this.formatDate(new Date());

    console.log(`[MomentumService.checkIn] Check-in for user ${userId} on ${today}`);

    // Get or create streak record
    const streakRecord = await this.getOrCreateStreakRecord(userId);

    // Idempotent: if already checked in today, return current state
    if (streakRecord.last_engagement_date === today) {
      console.log(`[MomentumService.checkIn] Already checked in today, returning current state`);
      const flameInfo = this.getFlameLevel(streakRecord.current_streak);
      return {
        new_momentum: streakRecord.current_streak,
        best_momentum: streakRecord.best_momentum,
        flame_level: flameInfo.level,
        flame_label: flameInfo.label,
        is_first_check_in_today: false,
        milestone_achieved: null,
        grace_day_available: !streakRecord.grace_day_used_this_week,
      };
    }

    // Reset grace_day_used_this_week on Mondays
    const now = new Date();
    const mondayOfThisWeek = this.getMondayOfWeek(now);
    if (
      !streakRecord.grace_day_week_start ||
      streakRecord.grace_day_week_start !== this.formatDate(mondayOfThisWeek)
    ) {
      streakRecord.grace_day_used_this_week = false;
      streakRecord.grace_day_week_start = this.formatDate(mondayOfThisWeek);
    }

    // Increment momentum
    const newMomentum = streakRecord.current_streak + 1;
    const newBestMomentum = Math.max(streakRecord.best_momentum, newMomentum);
    const flameInfo = this.getFlameLevel(newMomentum);

    // Check for milestone achievement
    const milestone = this.checkMilestoneAchieved(newMomentum);

    // Update record
    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        current_streak: newMomentum,
        longest_streak: Math.max(streakRecord.longest_streak, newMomentum),
        best_momentum: newBestMomentum,
        momentum_flame_level: flameInfo.level,
        last_engagement_date: today,
        grace_day_used_this_week: streakRecord.grace_day_used_this_week,
        grace_day_week_start: streakRecord.grace_day_week_start,
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error(`[MomentumService.checkIn] Update error:`, updateError);
      throw updateError;
    }

    console.log(`[MomentumService.checkIn] Momentum updated: ${newMomentum} (best: ${newBestMomentum}, flame: L${flameInfo.level})`);

    return {
      new_momentum: newMomentum,
      best_momentum: newBestMomentum,
      flame_level: flameInfo.level,
      flame_label: flameInfo.label,
      is_first_check_in_today: true,
      milestone_achieved: milestone,
      grace_day_available: !streakRecord.grace_day_used_this_week,
    };
  }

  // ============================================================================
  // CORE: DECAY
  // ============================================================================

  /**
   * Apply decay for a user who missed check-ins.
   * Called by cron job. Handles grace days, milestone protection, and tiered decay.
   */
  static async applyDecay(userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const today = new Date();
    const todayStr = this.formatDate(today);

    console.log(`[MomentumService.applyDecay] Applying decay for user ${userId}`);

    const streakRecord = await this.getOrCreateStreakRecord(userId);

    // If paused, skip decay
    if (streakRecord.paused) {
      console.log(`[MomentumService.applyDecay] User is paused, skipping`);
      return;
    }

    // If already checked in today, no decay needed
    if (streakRecord.last_engagement_date === todayStr) {
      console.log(`[MomentumService.applyDecay] Checked in today, no decay`);
      return;
    }

    // If no momentum, nothing to decay
    if (streakRecord.current_streak <= 0) {
      console.log(`[MomentumService.applyDecay] Momentum already at 0, skipping`);
      return;
    }

    // Calculate days missed
    const lastEngagement = streakRecord.last_engagement_date
      ? new Date(streakRecord.last_engagement_date)
      : null;

    if (!lastEngagement) {
      console.log(`[MomentumService.applyDecay] No last engagement date, skipping`);
      return;
    }

    const daysMissed = this.daysBetween(lastEngagement, today);

    if (daysMissed < 1) {
      console.log(`[MomentumService.applyDecay] Less than 1 day missed, skipping`);
      return;
    }

    // Reset grace_day_used_this_week on Mondays
    const mondayOfThisWeek = this.getMondayOfWeek(today);
    let graceUsedThisWeek = streakRecord.grace_day_used_this_week;
    let graceWeekStart = streakRecord.grace_day_week_start;

    if (!graceWeekStart || graceWeekStart !== this.formatDate(mondayOfThisWeek)) {
      graceUsedThisWeek = false;
      graceWeekStart = this.formatDate(mondayOfThisWeek);
    }

    // Check milestone protection: if within 1 day of a milestone, grant extra grace
    const hasMilestoneProtection = this.hasMilestoneProtection(streakRecord.current_streak);

    let decayAmount = 0;

    if (daysMissed === 1) {
      // 1 missed day: use grace day if available, or milestone protection
      if (!graceUsedThisWeek) {
        console.log(`[MomentumService.applyDecay] Grace day applied (1 missed day)`);
        graceUsedThisWeek = true;
        decayAmount = 0;
      } else if (hasMilestoneProtection) {
        console.log(`[MomentumService.applyDecay] Milestone protection applied (1 missed day)`);
        decayAmount = 0;
      } else {
        // No grace available for 1 missed day — still no decay per spec
        // (grace day logic: 1 free miss per week)
        // If grace already used, 1 day missed = treat as start of potential decay
        // But spec says grace = 1 free miss/week. If used, 1 miss still has no explicit decay.
        // The decay tiers start at 2 missed days. So 1 missed day with no grace = no decay yet,
        // but the next day will trigger the 2-day decay.
        decayAmount = 0;
      }
    } else if (daysMissed === 2) {
      // Check grace first (covers 1 of the 2 days)
      if (!graceUsedThisWeek) {
        graceUsedThisWeek = true;
        // Grace covers 1 day, so effectively only 1 day missed — no decay
        decayAmount = 0;
      } else if (hasMilestoneProtection) {
        // Milestone protection covers 1 extra day
        decayAmount = 0;
      } else {
        decayAmount = 3;
      }
    } else if (daysMissed === 3) {
      if (!graceUsedThisWeek) {
        graceUsedThisWeek = true;
        // Grace covers 1 day → effectively 2 missed → decay 3
        decayAmount = 3;
      } else if (hasMilestoneProtection) {
        decayAmount = 3; // Protection covers 1 day → effectively 2 missed
      } else {
        decayAmount = 7;
      }
    } else {
      // 4+ days missed
      const effectiveMissed = daysMissed - ((!graceUsedThisWeek ? 1 : 0) + (hasMilestoneProtection ? 1 : 0));
      if (!graceUsedThisWeek) graceUsedThisWeek = true;

      if (effectiveMissed <= 1) {
        decayAmount = 0;
      } else if (effectiveMissed === 2) {
        decayAmount = 3;
      } else if (effectiveMissed === 3) {
        decayAmount = 7;
      } else {
        // Base decay for first 3 effective missed days = 7, plus 5 per additional day
        const additionalDays = effectiveMissed - 3;
        decayAmount = 7 + (additionalDays * 5);
      }
    }

    const newMomentum = Math.max(0, streakRecord.current_streak - decayAmount);
    const newFlameLevel = this.getFlameLevel(newMomentum);

    console.log(`[MomentumService.applyDecay] Days missed: ${daysMissed}, decay: ${decayAmount}, momentum: ${streakRecord.current_streak} -> ${newMomentum}`);

    const { error: updateError } = await supabaseAdmin
      .from('engagement_streaks')
      .update({
        current_streak: newMomentum,
        momentum_flame_level: newFlameLevel.level,
        last_decay_applied_at: new Date().toISOString(),
        grace_day_used_this_week: graceUsedThisWeek,
        grace_day_week_start: graceWeekStart,
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error(`[MomentumService.applyDecay] Update error:`, updateError);
      throw updateError;
    }
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  /**
   * Get full momentum status for a user.
   */
  static async getStatus(userId: string): Promise<MomentumStatus> {
    const streakRecord = await this.getOrCreateStreakRecord(userId);
    const today = this.formatDate(new Date());
    const checkedInToday = streakRecord.last_engagement_date === today;
    const flameInfo = this.getFlameLevel(streakRecord.current_streak);

    // Reset grace tracking for display if it's a new week
    const mondayOfThisWeek = this.getMondayOfWeek(new Date());
    let graceUsedThisWeek = streakRecord.grace_day_used_this_week;
    if (
      !streakRecord.grace_day_week_start ||
      streakRecord.grace_day_week_start !== this.formatDate(mondayOfThisWeek)
    ) {
      graceUsedThisWeek = false;
    }

    // Find next milestone
    const nextMilestone = MILESTONES.find(m => m.days > streakRecord.current_streak) || null;
    const daysToNext = nextMilestone
      ? nextMilestone.days - streakRecord.current_streak
      : null;

    return {
      current_momentum: streakRecord.current_streak,
      best_momentum: streakRecord.best_momentum,
      flame_level: flameInfo.level,
      flame_label: flameInfo.label,
      grace_day_available: !graceUsedThisWeek,
      grace_day_used_this_week: graceUsedThisWeek,
      next_milestone: nextMilestone
        ? { ...nextMilestone, unlocked: false }
        : null,
      days_to_next_milestone: daysToNext,
      last_check_in_date: streakRecord.last_engagement_date,
      checked_in_today: checkedInToday,
    };
  }

  /**
   * Get unlocked milestones for a user with unlock dates.
   */
  static async getMilestones(userId: string): Promise<MomentumMilestone[]> {
    const streakRecord = await this.getOrCreateStreakRecord(userId);
    const bestMomentum = streakRecord.best_momentum;

    // Get check-in history to determine unlock dates
    const supabaseAdmin = createAdminSupabase();
    const { data: claims } = await supabaseAdmin
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .order('claim_date', { ascending: true });

    const claimDates = (claims || []).map((c: { claim_date: string }) => c.claim_date);

    return MILESTONES
      .filter(m => bestMomentum >= m.days)
      .map(m => {
        // Approximate unlock date: the Nth claim date
        const unlockDate = claimDates.length >= m.days
          ? claimDates[m.days - 1]
          : null;

        return {
          ...m,
          unlocked: true,
          unlocked_at: unlockDate || undefined,
        };
      });
  }

  // ============================================================================
  // FLAME LEVEL
  // ============================================================================

  /**
   * Get flame level and label for a given momentum value.
   */
  static getFlameLevel(currentStreak: number): { level: number; label: string } {
    for (const fl of FLAME_LEVELS) {
      if (currentStreak >= fl.min && currentStreak <= fl.max) {
        return { level: fl.level, label: fl.label };
      }
    }
    return { level: 1, label: 'Spark' };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Check if the user is within 1 day of a milestone (for protection).
   * Milestone protection days: days 2, 6, 13, 29, 59, 99, 364
   */
  private static hasMilestoneProtection(currentMomentum: number): boolean {
    return MILESTONE_DAYS.some(m => currentMomentum === m - 1);
  }

  /**
   * Check if a milestone was just achieved.
   */
  private static checkMilestoneAchieved(newMomentum: number): MomentumMilestone | null {
    const milestone = MILESTONES.find(m => m.days === newMomentum);
    if (!milestone) return null;
    return { ...milestone, unlocked: true, unlocked_at: new Date().toISOString() };
  }

  /**
   * Get or create the engagement_streaks record for a user.
   */
  private static async getOrCreateStreakRecord(userId: string) {
    const supabaseAdmin = createAdminSupabase();

    let { data: record, error } = await supabaseAdmin
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // Create new record
      const { data: newRecord, error: createError } = await supabaseAdmin
        .from('engagement_streaks')
        .insert({
          user_id: userId,
          current_streak: 0,
          longest_streak: 0,
          best_momentum: 0,
          momentum_flame_level: 1,
          grace_day_used_this_week: false,
          grace_day_week_start: this.formatDate(this.getMondayOfWeek(new Date())),
          streak_freezes_available: 1,
          streak_freezes_used_this_week: 0,
          auto_freeze_reset_date: this.formatDate(
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
          ),
        })
        .select()
        .single();

      if (createError) throw createError;
      record = newRecord;
    } else if (error) {
      throw error;
    }

    if (!record) throw new Error('Failed to get or create streak record');
    return record;
  }

  /**
   * Get the Monday of the current week.
   */
  private static getMondayOfWeek(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = Sunday
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
    d.setDate(diff);
    return d;
  }

  private static formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private static daysBetween(a: Date, b: Date): number {
    const aDate = new Date(a);
    aDate.setHours(0, 0, 0, 0);
    const bDate = new Date(b);
    bDate.setHours(0, 0, 0, 0);
    return Math.floor((bDate.getTime() - aDate.getTime()) / (1000 * 60 * 60 * 24));
  }
}

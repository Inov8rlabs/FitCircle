/**
 * Streak Service V2
 *
 * Business logic for daily check-in streaks including:
 * - Streak tracking and increment
 * - Freeze mechanics (1 per week)
 * - Milestone detection and badges
 * - Streak validation and recovery
 *
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getWeekStart } from './goal-service';

// ============================================================================
// TYPES
// ============================================================================

export interface UserStreak {
  id: string;
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_checkin_date: string | null;
  freeze_used_this_week: boolean;
  week_start_date: string | null;
  created_at: string;
  updated_at: string;
}

// Internal database type (maps to engagement_streaks table)
interface EngagementStreak {
  id: string;
  user_id: string;
  current_streak: number;
  longest_streak: number;
  last_engagement_date: string | null;
  streak_freezes_used_this_week: number;
  auto_freeze_reset_date: string | null;
  created_at: string;
  updated_at: string;
}

// Helper to map database model to API model
function mapToUserStreak(dbStreak: EngagementStreak): UserStreak {
  return {
    id: dbStreak.id,
    user_id: dbStreak.user_id,
    current_streak: dbStreak.current_streak,
    longest_streak: dbStreak.longest_streak,
    last_checkin_date: dbStreak.last_engagement_date,
    freeze_used_this_week: dbStreak.streak_freezes_used_this_week > 0,
    week_start_date: dbStreak.auto_freeze_reset_date,
    created_at: dbStreak.created_at,
    updated_at: dbStreak.updated_at,
  };
}

export interface StreakMilestone {
  days: number;
  name: string;
  description: string;
  badge: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const STREAK_MILESTONES: StreakMilestone[] = [
  { days: 3, name: '3-Day Starter', description: 'Started your journey!', badge: '🔥' },
  { days: 7, name: '1 Week Warrior', description: 'One week of consistency!', badge: '💪' },
  { days: 14, name: '2 Week Champion', description: 'Two weeks strong!', badge: '🏆' },
  { days: 30, name: 'Monthly Master', description: 'A full month!', badge: '🎖️' },
  { days: 60, name: '60-Day Dynamo', description: 'Two months of dedication!', badge: '⭐' },
  { days: 100, name: 'Centurion', description: 'The elite 100-day club!', badge: '👑' },
  { days: 365, name: 'Year Legend', description: 'A full year of commitment!', badge: '🏅' },
];

// ============================================================================
// STREAK OPERATIONS
// ============================================================================

/**
 * Get or create user streak record
 */
export async function getUserStreak(
  userId: string,
  supabase: SupabaseClient
): Promise<{ streak: UserStreak | null; error: Error | null }> {
  try {
    // Use existing engagement_streaks table instead of user_streaks
    const { data, error } = await supabase
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      return { streak: null, error: new Error(error.message) };
    }

    // If no streak exists, create one
    if (!data) {
      const newStreak = {
        user_id: userId,
        current_streak: 0,
        longest_streak: 0,
        last_engagement_date: null,
        streak_freezes_used_this_week: 0, // Integer, not boolean
        auto_freeze_reset_date: getWeekStart(),
      };

      const { data: created, error: createError } = await supabase
        .from('engagement_streaks')
        .insert(newStreak)
        .select()
        .single();

      if (createError) {
        return { streak: null, error: new Error(createError.message) };
      }

      return { streak: mapToUserStreak(created), error: null };
    }

    // Recalculate streak from streak_claims (source of truth)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split('T')[0];

    const { data: claims } = await supabase
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', ninetyDaysAgoStr)
      .order('claim_date', { ascending: false });

    const claimDates = new Set((claims || []).map(c => c.claim_date));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentStreak = 0;
    for (let i = 0; i < 90; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const checkDateStr = checkDate.toISOString().split('T')[0];

      if (claimDates.has(checkDateStr)) {
        currentStreak++;
      } else if (i === 0) {
        continue; // Today with no claim doesn't break streak yet
      } else {
        break; // Missed a day - streak is broken
      }
    }

    // Update stored value if it differs
    if (currentStreak !== data.current_streak) {
      await supabase
        .from('engagement_streaks')
        .update({ current_streak: currentStreak })
        .eq('user_id', userId);
      data.current_streak = currentStreak;
    }

    return { streak: mapToUserStreak(data), error: null };
  } catch (error) {
    return {
      streak: null,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Check if date is consecutive with last check-in
 */
export function isConsecutiveDay(lastCheckinDate: string | null, currentDate: string): boolean {
  if (!lastCheckinDate) {
    return true; // First check-in
  }

  const last = new Date(lastCheckinDate);
  const current = new Date(currentDate);

  // Calculate difference in days
  const diffTime = current.getTime() - last.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return diffDays === 1;
}

/**
 * Check if user missed exactly 1 day
 */
export function missedOneDay(lastCheckinDate: string | null, currentDate: string): boolean {
  if (!lastCheckinDate) {
    return false;
  }

  const last = new Date(lastCheckinDate);
  const current = new Date(currentDate);

  const diffTime = current.getTime() - last.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  return diffDays === 2;
}

/**
 * Check if freeze is available (not used this week)
 */
export function isFreezeAvailable(streak: UserStreak): boolean {
  if (!streak.week_start_date) {
    return true;
  }

  const currentWeekStart = getWeekStart();
  const streakWeekStart = streak.week_start_date.split('T')[0];

  // If it's a new week, reset freeze availability
  if (streakWeekStart !== currentWeekStart) {
    return true;
  }

  return !streak.freeze_used_this_week;
}

/**
 * Complete check-in and increment streak
 */
export async function completeCheckin(
  userId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{
  streak: UserStreak | null;
  milestoneReached: StreakMilestone | null;
  freezeUsed: boolean;
  error: Error | null;
}> {
  try {
    // Get current streak
    const { streak, error: streakError } = await getUserStreak(userId, supabase);

    if (streakError || !streak) {
      return { streak: null, milestoneReached: null, freezeUsed: false, error: streakError };
    }

    let newStreak = streak.current_streak;
    let freezeUsed = false;
    let newLongestStreak = streak.longest_streak;

    // Check if today already completed
    if (streak.last_checkin_date === date) {
      return { streak, milestoneReached: null, freezeUsed: false, error: null };
    }

    // Determine streak action
    if (isConsecutiveDay(streak.last_checkin_date, date)) {
      // Consecutive day - increment streak
      newStreak = streak.current_streak + 1;
    } else if (missedOneDay(streak.last_checkin_date, date) && isFreezeAvailable(streak)) {
      // Missed 1 day but freeze available - use freeze
      newStreak = streak.current_streak + 1;
      freezeUsed = true;
    } else {
      // Streak broken - reset to 1
      newStreak = 1;
    }

    // Update longest streak
    if (newStreak > newLongestStreak) {
      newLongestStreak = newStreak;
    }

    // Check for milestone
    const previousMilestone = STREAK_MILESTONES.filter(m => m.days <= streak.current_streak).pop();
    const currentMilestone = STREAK_MILESTONES.filter(m => m.days <= newStreak).pop();
    const milestoneReached =
      currentMilestone && (!previousMilestone || currentMilestone.days > previousMilestone.days)
        ? currentMilestone
        : null;

    // Update streak record
    const currentWeekStart = getWeekStart();
    const updates: any = {
      current_streak: newStreak,
      longest_streak: newLongestStreak,
      last_engagement_date: date, // Database field name
    };

    // Reset freeze if new week
    if (!streak.week_start_date || streak.week_start_date.split('T')[0] !== currentWeekStart) {
      updates.streak_freezes_used_this_week = freezeUsed ? 1 : 0; // Integer, not boolean
      updates.auto_freeze_reset_date = currentWeekStart;
    } else if (freezeUsed) {
      // Increment the freeze counter (can use RPC or calculate current + 1)
      updates.streak_freezes_used_this_week = (streak.freeze_used_this_week ? 1 : 0) + 1;
    }

    const { data: updated, error: updateError } = await supabase
      .from('engagement_streaks')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();

    if (updateError) {
      return { streak: null, milestoneReached: null, freezeUsed: false, error: new Error(updateError.message) };
    }

    // Update daily_tracking with streak_day
    await supabase
      .from('daily_tracking')
      .update({ streak_day: newStreak })
      .eq('user_id', userId)
      .eq('tracking_date', date);

    return { streak: mapToUserStreak(updated), milestoneReached, freezeUsed, error: null };
  } catch (error) {
    return {
      streak: null,
      milestoneReached: null,
      freezeUsed: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Manually use a freeze (for user-initiated action)
 */
export async function useFreeze(
  userId: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { streak, error: streakError } = await getUserStreak(userId, supabase);

    if (streakError || !streak) {
      return { success: false, error: streakError };
    }

    if (!isFreezeAvailable(streak)) {
      return { success: false, error: new Error('Freeze already used this week') };
    }

    // Mark freeze as used (increment counter)
    const { error: updateError } = await supabase
      .from('engagement_streaks')
      .update({ streak_freezes_used_this_week: 1 })
      .eq('user_id', userId);

    if (updateError) {
      return { success: false, error: new Error(updateError.message) };
    }

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get earned milestone badges for a user
 */
export async function getEarnedMilestones(
  userId: string,
  supabase: SupabaseClient
): Promise<{ milestones: StreakMilestone[]; error: Error | null }> {
  try {
    const { streak, error } = await getUserStreak(userId, supabase);

    if (error || !streak) {
      return { milestones: [], error };
    }

    // Return all milestones up to longest streak
    const earned = STREAK_MILESTONES.filter(m => m.days <= streak.longest_streak);

    return { milestones: earned, error: null };
  } catch (error) {
    return {
      milestones: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get next milestone for a user
 */
export function getNextMilestone(currentStreak: number): StreakMilestone | null {
  const next = STREAK_MILESTONES.find(m => m.days > currentStreak);
  return next || null;
}

// ============================================================================
// STREAK VALIDATION (for cron jobs)
// ============================================================================

/**
 * Validate streaks for all users (run at midnight)
 * Check for missed check-ins and apply freezes or break streaks
 */
export async function validateAllStreaks(
  supabase: SupabaseClient
): Promise<{
  validated: number;
  freezeApplied: number;
  broken: number;
  error: Error | null;
}> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Get all streaks
    const { data: streaks, error: streaksError } = await supabase
      .from('engagement_streaks')
      .select('*')
      .gt('current_streak', 0); // Only active streaks

    if (streaksError) {
      return { validated: 0, freezeApplied: 0, broken: 0, error: new Error(streaksError.message) };
    }

    let freezeApplied = 0;
    let broken = 0;

    for (const streak of streaks || []) {
      // Check if user CLAIMED yesterday (not just synced data)
      // IMPORTANT: Use streak_claims table, NOT daily_tracking.
      // daily_tracking contains auto-synced data which should NOT maintain streaks.
      const { data: claim } = await supabase
        .from('streak_claims')
        .select('id')
        .eq('user_id', streak.user_id)
        .eq('claim_date', yesterdayStr)
        .single();

      // If no claim yesterday and last check-in was day before yesterday
      if (!claim && streak.last_checkin_date) {
        const lastCheckin = new Date(streak.last_checkin_date);
        const diffTime = yesterday.getTime() - lastCheckin.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
          // Missed yesterday - apply freeze or break streak
          if (isFreezeAvailable(streak)) {
            // Auto-apply freeze (increment counter)
            await supabase
              .from('engagement_streaks')
              .update({ streak_freezes_used_this_week: 1 })
              .eq('user_id', streak.user_id);

            freezeApplied++;

            // TODO: Send notification "Streak at risk - freeze applied"
          } else {
            // Break streak
            await supabase
              .from('engagement_streaks')
              .update({ current_streak: 0 })
              .eq('user_id', streak.user_id);

            broken++;

            // TODO: Send notification "Streak broken - start fresh today!"
          }
        }
      }
    }

    return {
      validated: (streaks || []).length,
      freezeApplied,
      broken,
      error: null,
    };
  } catch (error) {
    return {
      validated: 0,
      freezeApplied: 0,
      broken: 0,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Reset weekly freezes for all users (run on Monday)
 */
export async function resetWeeklyFreezes(
  supabase: SupabaseClient
): Promise<{ reset: number; error: Error | null }> {
  try {
    const currentWeekStart = getWeekStart();

    const { data, error } = await supabase
      .from('engagement_streaks')
      .update({
        streak_freezes_used_this_week: 0, // Reset to 0, not false
        auto_freeze_reset_date: currentWeekStart, // Database field name
      })
      .neq('auto_freeze_reset_date', currentWeekStart)
      .select();

    if (error) {
      return { reset: 0, error: new Error(error.message) };
    }

    return { reset: (data || []).length, error: null };
  } catch (error) {
    return {
      reset: 0,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

// ============================================================================
// ACKNOWLEDGMENT FLOW
// ============================================================================

/**
 * Get previous day's data for acknowledgment flow
 */
export async function getPreviousDayData(
  userId: string,
  supabase: SupabaseClient
): Promise<{
  steps: number | null;
  stepsGoal: number | null;
  completed: boolean;
  error: Error | null;
}> {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Get yesterday's tracking
    const { data: tracking, error: trackingError } = await supabase
      .from('daily_tracking')
      .select('steps')
      .eq('user_id', userId)
      .eq('tracking_date', yesterdayStr)
      .single();

    if (trackingError && trackingError.code !== 'PGRST116') {
      return { steps: null, stepsGoal: null, completed: false, error: new Error(trackingError.message) };
    }

    // Get yesterday's steps goal
    const { data: goal, error: goalError } = await supabase
      .from('daily_goals')
      .select('target_value, completed')
      .eq('user_id', userId)
      .eq('date', yesterdayStr)
      .eq('goal_type', 'steps')
      .single();

    if (goalError && goalError.code !== 'PGRST116') {
      return { steps: null, stepsGoal: null, completed: false, error: new Error(goalError.message) };
    }

    return {
      steps: tracking?.steps || null,
      stepsGoal: goal?.target_value || null,
      completed: goal?.completed || false,
      error: null,
    };
  } catch (error) {
    return {
      steps: null,
      stepsGoal: null,
      completed: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Save previous day sentiment
 */
export async function savePreviousDaySentiment(
  userId: string,
  date: string,
  sentiment: 'great' | 'ok' | 'could_be_better',
  supabase: SupabaseClient
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await supabase
      .from('daily_tracking')
      .update({ previous_day_sentiment: sentiment })
      .eq('user_id', userId)
      .eq('tracking_date', date);

    if (error) {
      return { success: false, error: new Error(error.message) };
    }

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

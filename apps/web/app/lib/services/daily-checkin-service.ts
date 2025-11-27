/**
 * Daily Check-In Service
 *
 * Business logic for daily streak check-ins including:
 * - Check-in validation (once per day for streak)
 * - Streak tracking and increment
 * - XP/Points rewards
 * - Freeze mechanics (auto-apply and manual use)
 * - Milestone detection and rewards
 * - Mood/energy/weight tracking
 *
 * Part of Daily Streak Check-In Feature
 * Spec: /docs/DAILY-STREAK-CHECKIN-SPEC.md
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface DailyCheckInRequest {
  date?: string; // ISO date string (YYYY-MM-DD), defaults to today
  previousDaySentiment?: 'great' | 'ok' | 'could_be_better';
  mood: number; // 1-5
  energy: number; // 1-5
  weight?: number; // kg
  notes?: string;
}

export interface DailyCheckInResponse {
  success: boolean;
  newStreak: number;
  isFirstCheckInToday: boolean;
  milestoneAchieved?: {
    days: number;
    name: string;
    description: string;
    badge: string;
  };
  pointsEarned: number;
  totalPoints: number;
  freezeApplied?: boolean;
  freezeEarned?: boolean;
  message: string;
}

export interface StreakStatusResponse {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  hasCheckedInToday: boolean;
  freezesAvailable: number;
  nextMilestone: number | null;
  daysUntilNextMilestone: number | null;
  canCheckInAgain: boolean;
  streakColor: string;
  totalPoints: number;
}

export interface UseFreezeResponse {
  success: boolean;
  freezesRemaining: number;
  message: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const XP_PER_CHECKIN = 10;
const XP_MILESTONE_BONUS = 5;
const FREEZE_EARN_INTERVAL = 7; // Days between earning freezes
const MAX_FREEZES = 5;

export const STREAK_MILESTONES = [
  { days: 3, name: '3-Day Starter', description: 'Started your journey!', badge: '🔥' },
  { days: 7, name: '1 Week Warrior', description: 'One week of consistency!', badge: '💪' },
  { days: 14, name: '2 Week Champion', description: 'Two weeks strong!', badge: '🏆' },
  { days: 30, name: 'Monthly Master', description: 'A full month!', badge: '🎖️' },
  { days: 50, name: '50-Day Hero', description: 'Halfway to 100!', badge: '⭐' },
  { days: 100, name: 'Centurion', description: 'The elite 100-day club!', badge: '👑' },
  { days: 365, name: 'Year Legend', description: 'A full year of commitment!', badge: '🏅' },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get today's date in ISO format (YYYY-MM-DD)
 */
function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get yesterday's date in ISO format (YYYY-MM-DD)
 */
function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Check if date is consecutive with last check-in
 */
function isConsecutiveDay(lastCheckinDate: string | null, currentDate: string): boolean {
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
function missedOneDay(lastCheckinDate: string | null, currentDate: string): boolean {
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
 * Get next milestone for a given streak
 */
function getNextMilestone(currentStreak: number): { days: number; name: string } | null {
  const next = STREAK_MILESTONES.find(m => m.days > currentStreak);
  return next || null;
}

/**
 * Get streak color based on current streak
 */
function getStreakColor(streak: number): string {
  if (streak >= 100) return 'gold';
  if (streak >= 50) return 'purple';
  if (streak >= 30) return 'blue';
  if (streak >= 14) return 'green';
  if (streak >= 7) return 'orange';
  if (streak >= 3) return 'yellow';
  return 'gray';
}

/**
 * Check if a milestone was just achieved
 */
function checkMilestoneAchieved(
  previousStreak: number,
  newStreak: number
): { days: number; name: string; description: string; badge: string } | null {
  const previousMilestone = STREAK_MILESTONES.filter(m => m.days <= previousStreak).pop();
  const currentMilestone = STREAK_MILESTONES.filter(m => m.days <= newStreak).pop();

  if (currentMilestone && (!previousMilestone || currentMilestone.days > previousMilestone.days)) {
    return currentMilestone;
  }

  return null;
}

// ============================================================================
// CORE CHECK-IN LOGIC
// ============================================================================

/**
 * Perform daily check-in with streak tracking
 */
export async function performDailyCheckIn(
  userId: string,
  checkInData: DailyCheckInRequest,
  supabase: SupabaseClient
): Promise<DailyCheckInResponse> {
  const checkInDate = checkInData.date || getTodayDateString();
  const yesterday = getYesterdayDateString();

  // Start transaction-like operations
  // 1. Check if already checked in today (for streak purposes)
  // Look for ANY engagement activity on this date, not just streak_checkin
  const { data: existingActivities } = await supabase
    .from('engagement_activities')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_date', checkInDate)
    .limit(1);

  const isFirstCheckInToday = !existingActivities || existingActivities.length === 0;

  // 2. Get or create streak record
  const { data: streak, error: streakError } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (streakError && streakError.code !== 'PGRST116') {
    throw new Error(`Failed to fetch streak: ${streakError.message}`);
  }

  // Initialize streak if doesn't exist
  if (!streak) {
    const { data: newStreak, error: createError } = await supabase
      .from('engagement_streaks')
      .insert({
        user_id: userId,
        current_streak: 0,
        longest_streak: 0,
        last_engagement_date: null,
        streak_freezes_available: 1,
        streak_freezes_used_this_week: 0,
        total_points: 0,
      })
      .select()
      .single();

    if (createError) {
      throw new Error(`Failed to create streak: ${createError.message}`);
    }

    // Use the new streak record
    return performDailyCheckIn(userId, checkInData, supabase);
  }

  let newStreak = streak.current_streak;
  let freezeApplied = false;
  let freezeEarned = false;
  let pointsEarned = 0;
  let milestoneAchieved = null;

  // 3. Only process streak logic if this is first check-in today
  if (isFirstCheckInToday) {
    // Determine streak action
    if (isConsecutiveDay(streak.last_engagement_date, checkInDate)) {
      // Consecutive day - increment streak
      newStreak = streak.current_streak + 1;
      pointsEarned = XP_PER_CHECKIN;
    } else if (missedOneDay(streak.last_engagement_date, checkInDate)) {
      // Missed 1 day - check if freeze available
      if (streak.streak_freezes_available > 0) {
        // Auto-apply freeze
        newStreak = streak.current_streak + 1;
        pointsEarned = XP_PER_CHECKIN;
        freezeApplied = true;

        // Record freeze usage
        await supabase.from('engagement_activities').insert({
          user_id: userId,
          activity_date: yesterday,
          activity_type: 'freeze_used',
          metadata: { reason: 'auto_applied', missed_date: yesterday },
        });
      } else {
        // No freeze - streak broken, reset to 1
        newStreak = 1;
        pointsEarned = XP_PER_CHECKIN;
      }
    } else if (streak.last_engagement_date === null) {
      // First ever check-in
      newStreak = 1;
      pointsEarned = XP_PER_CHECKIN;
    } else {
      // More than 1 day missed - streak broken
      newStreak = 1;
      pointsEarned = XP_PER_CHECKIN;
    }

    // Check for milestone
    milestoneAchieved = checkMilestoneAchieved(streak.current_streak, newStreak);
    if (milestoneAchieved) {
      pointsEarned += XP_MILESTONE_BONUS;

      // Record milestone achievement
      await supabase.from('engagement_activities').insert({
        user_id: userId,
        activity_date: checkInDate,
        activity_type: 'milestone_achieved',
        metadata: { milestone: milestoneAchieved },
      });
    }

    // Check if freeze should be earned (every 7 consecutive days)
    if (newStreak % FREEZE_EARN_INTERVAL === 0 && newStreak > 0) {
      const daysSinceLastFreeze = streak.last_freeze_earned_at
        ? Math.floor(
            (new Date(checkInDate).getTime() - new Date(streak.last_freeze_earned_at).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : FREEZE_EARN_INTERVAL;

      if (daysSinceLastFreeze >= FREEZE_EARN_INTERVAL) {
        const newFreezesAvailable = Math.min(
          streak.streak_freezes_available + 1,
          MAX_FREEZES
        );

        if (newFreezesAvailable > streak.streak_freezes_available) {
          freezeEarned = true;

          // Update freeze count
          await supabase
            .from('engagement_streaks')
            .update({
              streak_freezes_available: newFreezesAvailable,
              last_freeze_earned_at: new Date().toISOString(),
            })
            .eq('user_id', userId);

          // Record freeze earned
          await supabase.from('engagement_activities').insert({
            user_id: userId,
            activity_date: checkInDate,
            activity_type: 'freeze_earned',
            metadata: { streak_at_earn: newStreak },
          });
        }
      }
    }

    // Update streak record
    const newLongestStreak = Math.max(newStreak, streak.longest_streak);
    const newTotalPoints = streak.total_points + pointsEarned;

    const updates: any = {
      current_streak: newStreak,
      longest_streak: newLongestStreak,
      last_engagement_date: checkInDate,
      total_points: newTotalPoints,
      updated_at: new Date().toISOString(),
    };

    // Decrement freeze if used
    if (freezeApplied) {
      updates.streak_freezes_available = Math.max(streak.streak_freezes_available - 1, 0);
    }

    await supabase.from('engagement_streaks').update(updates).eq('user_id', userId);
  }

  // Record check-in activity (ALWAYS, for timestamp tracking)
  // Use unique reference_id to allow multiple check-ins per day
  const checkInTimestamp = new Date().toISOString();
  await supabase.from('engagement_activities').insert({
    user_id: userId,
    activity_date: checkInDate,
    activity_type: 'streak_checkin',
    reference_id: crypto.randomUUID(), // Unique ID for each check-in
    metadata: {
      xp_earned: isFirstCheckInToday ? pointsEarned : 0,
      new_streak: isFirstCheckInToday ? newStreak : streak.current_streak,
      milestone: isFirstCheckInToday ? (milestoneAchieved?.name || null) : null,
      checked_in_at: checkInTimestamp,
      is_first_checkin_today: isFirstCheckInToday,
    },
  });

  // 4. Update or create daily_tracking entry (always, even for subsequent check-ins)
  const { data: existingTracking } = await supabase
    .from('daily_tracking')
    .select('*')
    .eq('user_id', userId)
    .eq('tracking_date', checkInDate)
    .single();

  const trackingData: any = {
    mood_score: checkInData.mood,
    energy_level: checkInData.energy,
  };

  if (checkInData.weight !== undefined) {
    trackingData.weight_kg = checkInData.weight;
  }

  if (checkInData.notes !== undefined) {
    trackingData.notes = checkInData.notes;
  }

  if (checkInData.previousDaySentiment !== undefined) {
    trackingData.previous_day_sentiment = checkInData.previousDaySentiment;
  }

  if (isFirstCheckInToday) {
    trackingData.streak_day = newStreak;
  }

  if (existingTracking) {
    // Update existing tracking
    await supabase
      .from('daily_tracking')
      .update(trackingData)
      .eq('user_id', userId)
      .eq('tracking_date', checkInDate);
  } else {
    // Create new tracking entry
    await supabase.from('daily_tracking').insert({
      user_id: userId,
      tracking_date: checkInDate,
      ...trackingData,
      streak_day: newStreak,
    });
  }

  // 5. Build response
  let message = '';
  if (!isFirstCheckInToday) {
    message = 'Check-in data updated. Streak already counted for today.';
  } else if (freezeApplied) {
    message = `Freeze applied! Streak maintained at ${newStreak} days.`;
  } else if (milestoneAchieved) {
    message = `🎉 Milestone achieved! ${milestoneAchieved.name} - ${newStreak} days!`;
  } else if (newStreak === 1 && streak.current_streak > 1) {
    message = 'Streak reset. Start fresh today!';
  } else {
    message = `Great! ${newStreak} day streak!`;
  }

  if (freezeEarned) {
    message += ' You earned a freeze!';
  }

  return {
    success: true,
    newStreak,
    isFirstCheckInToday,
    milestoneAchieved: milestoneAchieved || undefined,
    pointsEarned,
    totalPoints: streak.total_points + pointsEarned,
    freezeApplied: freezeApplied || undefined,
    freezeEarned: freezeEarned || undefined,
    message,
  };
}

/**
 * Get current streak status
 */
export async function getStreakStatus(
  userId: string,
  supabase: SupabaseClient
): Promise<StreakStatusResponse> {
  const today = getTodayDateString();

  // Get streak record
  const { data: streak } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!streak) {
    // Initialize if doesn't exist
    await supabase.from('engagement_streaks').insert({
      user_id: userId,
      current_streak: 0,
      longest_streak: 0,
      last_engagement_date: null,
      streak_freezes_available: 1,
      total_points: 0,
    });

    return {
      currentStreak: 0,
      longestStreak: 0,
      lastCheckInDate: null,
      hasCheckedInToday: false,
      freezesAvailable: 1,
      nextMilestone: STREAK_MILESTONES[0].days,
      daysUntilNextMilestone: STREAK_MILESTONES[0].days,
      canCheckInAgain: true,
      streakColor: 'gray',
      totalPoints: 0,
    };
  }

  // Check if checked in today (ANY engagement activity counts)
  const { data: todayActivities } = await supabase
    .from('engagement_activities')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_date', today)
    .limit(1);

  const hasCheckedInToday = !!todayActivities && todayActivities.length > 0;
  const nextMilestone = getNextMilestone(streak.current_streak);

  return {
    currentStreak: streak.current_streak,
    longestStreak: streak.longest_streak,
    lastCheckInDate: streak.last_engagement_date,
    hasCheckedInToday,
    freezesAvailable: streak.streak_freezes_available || 0,
    nextMilestone: nextMilestone?.days || null,
    daysUntilNextMilestone: nextMilestone ? nextMilestone.days - streak.current_streak : null,
    canCheckInAgain: true, // Can always update mood/energy/weight
    streakColor: getStreakColor(streak.current_streak),
    totalPoints: streak.total_points || 0,
  };
}

/**
 * Manually use a freeze (for planned absence)
 */
export async function useFreeze(
  userId: string,
  supabase: SupabaseClient
): Promise<UseFreezeResponse> {
  const today = getTodayDateString();

  // Get streak record
  const { data: streak } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!streak) {
    throw new Error('Streak record not found');
  }

  // Check if freeze available
  if (streak.streak_freezes_available <= 0) {
    return {
      success: false,
      freezesRemaining: 0,
      message: 'No freezes available',
    };
  }

  // Check if already used freeze today
  const { data: existingFreeze } = await supabase
    .from('engagement_activities')
    .select('*')
    .eq('user_id', userId)
    .eq('activity_date', today)
    .eq('activity_type', 'freeze_used')
    .single();

  if (existingFreeze) {
    return {
      success: false,
      freezesRemaining: streak.streak_freezes_available,
      message: 'Freeze already used for today',
    };
  }

  // Decrement freezes_available
  const newFreezesAvailable = streak.streak_freezes_available - 1;

  await supabase
    .from('engagement_streaks')
    .update({ streak_freezes_available: newFreezesAvailable })
    .eq('user_id', userId);

  // Record freeze usage
  await supabase.from('engagement_activities').insert({
    user_id: userId,
    activity_date: today,
    activity_type: 'freeze_used',
    metadata: { reason: 'manual', planned: true },
  });

  return {
    success: true,
    freezesRemaining: newFreezesAvailable,
    message: `Freeze applied successfully! ${newFreezesAvailable} freezes remaining.`,
  };
}

/**
 * Streak Service V2 — compatibility adapter.
 *
 * Historically this was a third, parallel streak implementation with its own
 * freeze accounting (`streak_freezes_used_this_week`). It is now a thin
 * adapter over the canonical modules so the legacy web routes
 * (/api/streaks/current, /checkin, /freeze, /milestones) keep their response
 * shapes while all logic lives in one place:
 * - streak math:      lib/streaks/streak-calculator (claims-derived)
 * - milestones:       lib/streaks/streak-config
 * - shield inventory: StreakShieldService
 */

import { type SupabaseClient } from '@supabase/supabase-js';

import {
  MILESTONES,
  milestoneCrossed,
  nextMilestone,
  type StreakMilestoneDef,
} from '../streaks/streak-config';
import { localToday, addDays, calculateStreak } from '../streaks/streak-calculator';

import { useFreeze as useShieldForToday } from './daily-checkin-service';
import { StreakClaimingService } from './streak-claiming-service';
import { StreakShieldService } from './streak-shield-service';

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

export interface StreakMilestone {
  days: number;
  name: string;
  description: string;
  badge: string;
}

/** @deprecated import MILESTONES from lib/streaks/streak-config instead. */
export const STREAK_MILESTONES: StreakMilestone[] = MILESTONES.map(
  ({ days, name, description, badge }) => ({ days, name, description, badge })
);

// Internal database type (maps to engagement_streaks table)
interface EngagementStreakRow {
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

function mapToUserStreak(dbStreak: EngagementStreakRow): UserStreak {
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

// ============================================================================
// STREAK OPERATIONS
// ============================================================================

/**
 * Get or create user streak record, recalculated from streak_claims.
 */
export async function getUserStreak(
  userId: string,
  supabase: SupabaseClient,
  timezone?: string
): Promise<{ streak: UserStreak | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from('engagement_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      return { streak: null, error: new Error(error.message) };
    }

    if (!data) {
      const { data: created, error: createError } = await supabase
        .from('engagement_streaks')
        .insert({
          user_id: userId,
          current_streak: 0,
          longest_streak: 0,
          last_engagement_date: null,
          streak_freezes_used_this_week: 0,
        })
        .select()
        .single();

      if (createError) {
        return { streak: null, error: new Error(createError.message) };
      }
      return { streak: mapToUserStreak(created), error: null };
    }

    // Recalculate from streak_claims (source of truth)
    const today = localToday(timezone);
    const { data: claims } = await supabase
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', addDays(today, -730));

    const claimDates = new Set((claims || []).map(c => c.claim_date));
    const currentStreak = calculateStreak(claimDates, today);

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

/** Live shield availability for route responses. */
export async function getShieldAvailability(
  userId: string
): Promise<{ available: number; unlimited: boolean }> {
  const inventory = await StreakShieldService.getInventory(userId);
  return { available: inventory.available, unlimited: inventory.unlimited };
}

/**
 * Complete a bare streak check-in (claims-based). Unlike the mobile daily
 * check-in flow this records no mood/energy — it only claims the day,
 * shields a 1-day gap when possible, and reports crossed milestones.
 */
export async function completeCheckin(
  userId: string,
  date: string,
  supabase: SupabaseClient,
  timezone?: string
): Promise<{
  streak: UserStreak | null;
  milestoneReached: StreakMilestone | null;
  freezeUsed: boolean;
  error: Error | null;
}> {
  try {
    const checkInDate = date || localToday(timezone);

    const { data: claims } = await supabase
      .from('streak_claims')
      .select('claim_date')
      .eq('user_id', userId)
      .gte('claim_date', addDays(checkInDate, -730));

    const claimDates = new Set((claims || []).map(c => c.claim_date));

    if (claimDates.has(checkInDate)) {
      const current = await getUserStreak(userId, supabase, timezone);
      return { streak: current.streak, milestoneReached: null, freezeUsed: false, error: null };
    }

    // Shield a single missed day so the streak survives (best-effort).
    // Runs BEFORE oldStreak is measured so a bridged gap doesn't re-fire
    // milestones the prior run already earned.
    const gap = await StreakClaimingService.tryAutoProtectYesterday(
      userId,
      claimDates,
      checkInDate,
      timezone
    );
    const freezeUsed = gap.applied;

    const oldStreak = calculateStreak(claimDates, checkInDate);

    const { error: claimError } = await supabase.from('streak_claims').upsert(
      {
        user_id: userId,
        claim_date: checkInDate,
        claimed_at: new Date().toISOString(),
        claim_method: 'explicit',
        timezone: timezone || 'UTC',
        health_data_synced: false,
        metadata: { source: 'web_checkin' },
      },
      { onConflict: 'user_id,claim_date' }
    );
    if (claimError) {
      return { streak: null, milestoneReached: null, freezeUsed, error: new Error(claimError.message) };
    }
    claimDates.add(checkInDate);

    // Every claim path writes an activity row — client activity feeds use
    // engagement_activities as their signal for "this day counted".
    const { error: activityError } = await supabase.from('engagement_activities').insert({
      user_id: userId,
      activity_date: checkInDate,
      activity_type: 'circle_checkin',
      reference_id: null,
    });
    if (activityError && activityError.code !== '23505') {
      console.error('[completeCheckin] activity insert error (non-blocking):', activityError);
    }

    const newStreak = calculateStreak(claimDates, checkInDate);
    const crossed = milestoneCrossed(oldStreak, newStreak);

    await StreakShieldService.earnForStreakIncrease(userId, oldStreak, newStreak).catch(e =>
      console.error('[completeCheckin] shield earn error (non-blocking):', e)
    );

    const { data: record } = await supabase
      .from('engagement_streaks')
      .select('longest_streak')
      .eq('user_id', userId)
      .maybeSingle();

    await supabase.from('engagement_streaks').upsert(
      {
        user_id: userId,
        current_streak: newStreak,
        longest_streak: Math.max(newStreak, record?.longest_streak || 0),
        last_engagement_date: checkInDate,
      },
      { onConflict: 'user_id' }
    );

    await supabase
      .from('daily_tracking')
      .update({ streak_day: newStreak })
      .eq('user_id', userId)
      .eq('tracking_date', checkInDate);

    const after = await getUserStreak(userId, supabase, timezone);
    return {
      streak: after.streak,
      milestoneReached: crossed
        ? { days: crossed.days, name: crossed.name, description: crossed.description, badge: crossed.badge }
        : null,
      freezeUsed,
      error: null,
    };
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
 * Manually use a shield to protect today (planned absence).
 */
export async function useFreeze(
  userId: string,
  supabase: SupabaseClient,
  timezone?: string
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const result = await useShieldForToday(userId, supabase, timezone);
    return {
      success: result.success,
      error: result.success ? null : new Error(result.message),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get earned milestone badges for a user (everything at or below the
 * longest streak).
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
  const next: StreakMilestoneDef | null = nextMilestone(currentStreak);
  return next ? { days: next.days, name: next.name, description: next.description, badge: next.badge } : null;
}

// ============================================================================
// ACKNOWLEDGMENT FLOW
// ============================================================================

/**
 * Get previous day's data for acknowledgment flow
 */
export async function getPreviousDayData(
  userId: string,
  supabase: SupabaseClient,
  timezone?: string
): Promise<{
  steps: number | null;
  stepsGoal: number | null;
  completed: boolean;
  error: Error | null;
}> {
  try {
    const yesterdayStr = addDays(localToday(timezone), -1);

    const { data: tracking, error: trackingError } = await supabase
      .from('daily_tracking')
      .select('steps')
      .eq('user_id', userId)
      .eq('tracking_date', yesterdayStr)
      .maybeSingle();

    if (trackingError) {
      return { steps: null, stepsGoal: null, completed: false, error: new Error(trackingError.message) };
    }

    const { data: goal, error: goalError } = await supabase
      .from('daily_goals')
      .select('target_value, completed')
      .eq('user_id', userId)
      .eq('date', yesterdayStr)
      .eq('goal_type', 'steps')
      .maybeSingle();

    if (goalError) {
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

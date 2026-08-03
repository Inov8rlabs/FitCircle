/**
 * Daily Check-In Service
 *
 * Business logic for the daily check-in flow (mood/energy/weight + streak):
 * - Check-in validation (streak counted once per local day)
 * - Streak derived from `streak_claims` (single source of truth)
 * - XP/points rewards
 * - Shield mechanics via StreakShieldService (auto-apply for a 1-day gap,
 *   Pro unlimited, paywall hint when a free user runs out)
 * - Milestone detection from lib/streaks/streak-config
 *
 * Part of Daily Streak Check-In Feature
 * Spec: /docs/STREAKS-SPEC.md
 */

import { type SupabaseClient } from '@supabase/supabase-js';

import { milestoneCrossed, nextMilestone, streakColor } from '../streaks/streak-config';
import { localToday, addDays, calculateStreak } from '../streaks/streak-calculator';
import { StreakClaimError, CLAIM_ERROR_CODES } from '../types/streak-claiming';

import { EngagementStreakService } from './engagement-streak-service';
import { MomentumService } from './momentum-service';
import { StreakClaimingService } from './streak-claiming-service';
import { StreakShieldService } from './streak-shield-service';

// ============================================================================
// TYPES
// ============================================================================

export interface DailyCheckInRequest {
  date?: string; // ISO date string (YYYY-MM-DD), defaults to today
  timezone?: string; // IANA timezone from the client
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
  /** Free user just lost streak protection — a good moment to pitch Pro. */
  paywallSuggested?: boolean;
  message: string;
}

export interface StreakStatusResponse {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  hasCheckedInToday: boolean;
  freezesAvailable: number;
  /** Pro users have unlimited shields; clients should render ∞. */
  shieldsUnlimited?: boolean;
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


// ============================================================================
// CORE CHECK-IN LOGIC
// ============================================================================

/**
 * Perform daily check-in with streak tracking.
 *
 * The streak part is claim-based: the first check-in of a local day writes a
 * streak_claims row and the streak is recomputed from claims. If yesterday
 * was missed, a shield is auto-applied when possible (Pro: always) so the
 * user keeps their streak; a free user with no shields sees the streak reset
 * plus a paywall suggestion.
 */
export async function performDailyCheckIn(
  userId: string,
  checkInData: DailyCheckInRequest,
  supabase: SupabaseClient
): Promise<DailyCheckInResponse> {
  const timezone = checkInData.timezone;
  const todayStr = localToday(timezone);
  const checkInDate = checkInData.date || todayStr;

  // 1. Get or create streak record (for points + longest)
  let { data: streak } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!streak) {
    const { data: newStreakRecord, error: createError } = await supabase
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
    if (createError) throw new Error(`Failed to create streak: ${createError.message}`);
    streak = newStreakRecord;
  }

  // 2. Existing claims decide whether this is the first check-in of the day
  const { data: claims } = await supabase
    .from('streak_claims')
    .select('claim_date')
    .eq('user_id', userId)
    .gte('claim_date', addDays(checkInDate, -730));

  const claimDates = new Set((claims || []).map(c => c.claim_date));
  const isFirstCheckInToday = !claimDates.has(checkInDate);

  let newStreak = streak.current_streak;
  let freezeApplied = false;
  let freezeEarned = false;
  let paywallSuggested = false;
  let pointsEarned = 0;
  let milestoneAchieved: DailyCheckInResponse['milestoneAchieved'] | undefined;

  if (isFirstCheckInToday) {
    // 2a. Yesterday missed but the day before claimed? Try to shield the gap
    //     so the streak survives (relative to checkInDate, not server UTC).
    //     This runs BEFORE oldStreak is measured: with the gap bridged,
    //     oldStreak reflects the real prior run, so already-earned
    //     milestones/shields don't re-fire on a shielded check-in.
    const gap = await StreakClaimingService.tryAutoProtectYesterday(
      userId,
      claimDates,
      checkInDate,
      timezone
    );
    freezeApplied = gap.applied;
    paywallSuggested = gap.outOfShields; // out of shields → streak restarts below

    const oldStreak = calculateStreak(claimDates, checkInDate);

    // 2b. Record the claim for the check-in day
    const { error: claimInsertError } = await supabase.from('streak_claims').upsert(
      {
        user_id: userId,
        claim_date: checkInDate,
        claimed_at: new Date().toISOString(),
        claim_method: 'explicit',
        timezone: timezone || 'UTC',
        health_data_synced: checkInData.weight !== undefined,
        metadata: { source: 'daily_checkin', mood: checkInData.mood, energy: checkInData.energy },
      },
      { onConflict: 'user_id,claim_date' }
    );
    if (claimInsertError) {
      throw new Error(`Failed to record check-in claim: ${claimInsertError.message}`);
    }
    claimDates.add(checkInDate);

    // 2c. Recompute streak from claims
    newStreak = calculateStreak(claimDates, checkInDate);
    pointsEarned = XP_PER_CHECKIN;

    // 2d. Milestones + earned shields
    const crossed = milestoneCrossed(oldStreak, newStreak);
    if (crossed) {
      milestoneAchieved = {
        days: crossed.days,
        name: crossed.name,
        description: crossed.description,
        badge: crossed.badge,
      };
      pointsEarned += XP_MILESTONE_BONUS;

      await supabase.from('engagement_activities').insert({
        user_id: userId,
        activity_date: checkInDate,
        activity_type: 'milestone_achieved',
        metadata: { milestone: milestoneAchieved },
      });
    }

    try {
      const credited = await StreakShieldService.earnForStreakIncrease(userId, oldStreak, newStreak);
      freezeEarned = credited > 0;
      if (freezeEarned) {
        await supabase.from('engagement_activities').insert({
          user_id: userId,
          activity_date: checkInDate,
          activity_type: 'freeze_earned',
          metadata: { streak_at_earn: newStreak, shields_credited: credited },
        });
      }
    } catch (e) {
      console.error('[performDailyCheckIn] shield earn error (non-blocking):', e);
    }

    // 2e. Persist denormalized streak + points
    await supabase
      .from('engagement_streaks')
      .update({
        current_streak: newStreak,
        longest_streak: Math.max(newStreak, streak.longest_streak),
        last_engagement_date: checkInDate,
        total_points: streak.total_points + pointsEarned,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  // 3. Record check-in activity (ALWAYS, for timestamp tracking)
  const checkInTimestamp = new Date().toISOString();
  await supabase.from('engagement_activities').insert({
    user_id: userId,
    activity_date: checkInDate,
    activity_type: 'streak_checkin',
    reference_id: crypto.randomUUID(),
    metadata: {
      xp_earned: isFirstCheckInToday ? pointsEarned : 0,
      new_streak: isFirstCheckInToday ? newStreak : streak.current_streak,
      milestone: isFirstCheckInToday ? milestoneAchieved?.name || null : null,
      checked_in_at: checkInTimestamp,
      is_first_checkin_today: isFirstCheckInToday,
    },
  });

  // 4. Update or create daily_tracking entry (always, even for subsequent check-ins)
  const { data: existingTracking } = await supabase
    .from('daily_tracking')
    .select('id')
    .eq('user_id', userId)
    .eq('tracking_date', checkInDate)
    .maybeSingle();

  const trackingData: Record<string, unknown> = {
    mood_score: checkInData.mood,
    energy_level: checkInData.energy,
  };
  if (checkInData.weight !== undefined) trackingData.weight_kg = checkInData.weight;
  if (checkInData.notes !== undefined) trackingData.notes = checkInData.notes;
  if (checkInData.previousDaySentiment !== undefined) {
    trackingData.previous_day_sentiment = checkInData.previousDaySentiment;
  }
  if (isFirstCheckInToday) trackingData.streak_day = newStreak;

  if (existingTracking) {
    await supabase
      .from('daily_tracking')
      .update(trackingData)
      .eq('user_id', userId)
      .eq('tracking_date', checkInDate);
  } else {
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
    message = `Shield applied! Streak maintained at ${newStreak} days.`;
  } else if (milestoneAchieved) {
    message = `🎉 Milestone achieved! ${milestoneAchieved.name} - ${newStreak} days!`;
  } else if (newStreak === 1 && streak.current_streak > 1) {
    message = 'Streak reset. Start fresh today!';
  } else {
    message = `Great! ${newStreak} day streak!`;
  }
  if (freezeEarned) {
    message += ' You earned a streak shield!';
  }

  if (isFirstCheckInToday) {
    try {
      await MomentumService.checkIn(userId);
    } catch (momentumError) {
      console.error('[performDailyCheckIn] Momentum check-in failed (non-blocking):', momentumError);
    }
  }

  return {
    success: true,
    newStreak,
    isFirstCheckInToday,
    milestoneAchieved,
    pointsEarned,
    totalPoints: streak.total_points + pointsEarned,
    freezeApplied: freezeApplied || undefined,
    freezeEarned: freezeEarned || undefined,
    paywallSuggested: paywallSuggested || undefined,
    message,
  };
}

/**
 * Get current streak status (timezone-aware).
 */
export async function getStreakStatus(
  userId: string,
  supabase: SupabaseClient,
  timezone?: string
): Promise<StreakStatusResponse> {
  const today = localToday(timezone);

  const { data: streak } = await supabase
    .from('engagement_streaks')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!streak) {
    await supabase.from('engagement_streaks').insert({
      user_id: userId,
      current_streak: 0,
      longest_streak: 0,
      last_engagement_date: null,
      streak_freezes_available: 1,
      total_points: 0,
    });

    const first = nextMilestone(0);
    return {
      currentStreak: 0,
      longestStreak: 0,
      lastCheckInDate: null,
      hasCheckedInToday: false,
      freezesAvailable: 1,
      nextMilestone: first?.days || null,
      daysUntilNextMilestone: first?.days || null,
      canCheckInAgain: true,
      streakColor: streakColor(0),
      totalPoints: 0,
    };
  }

  const { data: claims } = await supabase
    .from('streak_claims')
    .select('claim_date')
    .eq('user_id', userId)
    .gte('claim_date', addDays(today, -730))
    .order('claim_date', { ascending: false });

  const claimDates = new Set((claims || []).map(c => c.claim_date));
  const hasCheckedInToday = claimDates.has(today);
  const currentStreak = calculateStreak(claimDates, today);

  if (currentStreak !== streak.current_streak) {
    await supabase
      .from('engagement_streaks')
      .update({ current_streak: currentStreak })
      .eq('user_id', userId);
  }

  // Shield inventory (single source of truth) — fall back to the mirror column.
  let freezesAvailable = streak.streak_freezes_available || 0;
  let shieldsUnlimited: boolean | undefined;
  try {
    const inventory = await StreakShieldService.getInventory(userId);
    freezesAvailable = inventory.available;
    shieldsUnlimited = inventory.unlimited;
  } catch (e) {
    console.error('[getStreakStatus] shield inventory error (using mirror):', e);
  }

  const longestStreak = Math.max(currentStreak, streak.longest_streak);
  const next = nextMilestone(currentStreak);

  return {
    currentStreak,
    longestStreak,
    lastCheckInDate: claims && claims.length > 0 ? claims[0].claim_date : streak.last_engagement_date,
    hasCheckedInToday,
    freezesAvailable,
    shieldsUnlimited,
    nextMilestone: next?.days || null,
    daysUntilNextMilestone: next ? next.days - currentStreak : null,
    canCheckInAgain: true, // Can always update mood/energy/weight
    streakColor: streakColor(currentStreak),
    totalPoints: streak.total_points || 0,
  };
}

/**
 * Manually use a shield for a planned absence (protects TODAY).
 */
export async function useFreeze(
  userId: string,
  supabase: SupabaseClient,
  timezone?: string
): Promise<UseFreezeResponse> {
  const today = localToday(timezone);

  // Already claimed/protected today? Nothing to do.
  const { data: existing } = await supabase
    .from('streak_claims')
    .select('id')
    .eq('user_id', userId)
    .eq('claim_date', today)
    .maybeSingle();

  if (existing) {
    const inventory = await StreakShieldService.getInventory(userId);
    return {
      success: false,
      freezesRemaining: inventory.available,
      message: 'Today is already claimed or protected',
    };
  }

  let consumed;
  try {
    consumed = await StreakShieldService.consume(userId);
  } catch (e) {
    if (e instanceof StreakClaimError && e.code === CLAIM_ERROR_CODES.NO_SHIELDS_AVAILABLE) {
      return { success: false, freezesRemaining: 0, message: 'No freezes available' };
    }
    throw e;
  }

  await supabase.from('streak_claims').upsert(
    {
      user_id: userId,
      claim_date: today,
      claimed_at: new Date().toISOString(),
      claim_method: 'freeze',
      timezone: timezone || 'UTC',
      health_data_synced: false,
      metadata: { source: 'manual_freeze', planned: true, shield_type: consumed.consumedType },
    },
    { onConflict: 'user_id,claim_date' }
  );

  await supabase.from('engagement_activities').insert({
    user_id: userId,
    activity_date: today,
    activity_type: 'freeze_used',
    metadata: { reason: 'manual', planned: true },
  });

  // Refresh the denormalized streak so mirror readers see today protected.
  try {
    await EngagementStreakService.updateEngagementStreak(userId, today);
  } catch (e) {
    console.error('[useFreeze] streak refresh failed (non-blocking):', e);
  }

  const remainingText = consumed.unlimited ? 'Unlimited shields (Pro)' : `${consumed.remaining} shields remaining`;
  return {
    success: true,
    freezesRemaining: consumed.unlimited ? Number.MAX_SAFE_INTEGER : consumed.remaining,
    message: `Shield applied for today! ${remainingText}.`,
  };
}

// Previous-day acknowledgment data lives in streak-service-v2's
// getPreviousDayData — import from there; no duplicate here.

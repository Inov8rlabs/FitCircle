/**
 * Leaderboard Service V2
 *
 * Business logic for FitCircle leaderboards including:
 * - Ranking calculations (steps, weight loss %)
 * - Real-time leaderboard updates
 * - Tie-breaking logic (earliest timestamp wins)
 * - Rank change tracking
 *
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getWeekStart } from './goal-service';

// ============================================================================
// TYPES
// ============================================================================

export type LeaderboardPeriod = 'daily' | 'weekly' | 'monthly' | 'all_time';
export type MetricType = 'steps' | 'weight_loss_pct' | 'checkin_streak';

export interface LeaderboardEntry {
  id: string;
  fitcircle_id: string;
  user_id: string;
  period: LeaderboardPeriod;
  period_start: string;
  metric_type: MetricType;
  metric_value: number;
  rank: number;
  rank_change: number;
  last_updated: string;
  created_at: string;
}

export interface LeaderboardEntryWithProfile extends LeaderboardEntry {
  profile: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface LeaderboardStats {
  user_id: string;
  metric_value: number;
  submission_timestamp?: string;
  starting_weight?: number;
  current_weight?: number;
  target_weight?: number;
}

// ============================================================================
// PERIOD HELPERS
// ============================================================================

/**
 * Get period start date for a given period type
 */
export function getPeriodStart(period: LeaderboardPeriod, date: Date = new Date()): string {
  switch (period) {
    case 'daily':
      return date.toISOString().split('T')[0];
    case 'weekly':
      return getWeekStart(date);
    case 'monthly':
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}-01`;
    case 'all_time':
      return '1970-01-01'; // Epoch start
  }
}

// ============================================================================
// METRIC CALCULATION
// ============================================================================

/**
 * Calculate steps metric for a user in a period
 */
export async function calculateStepsMetric(
  userId: string,
  fitcircleId: string,
  period: LeaderboardPeriod,
  periodStart: string,
  supabase: SupabaseClient
): Promise<{ value: number; timestamp: string | null }> {
  try {
    const today = new Date().toISOString().split('T')[0];
    let startDate = periodStart;
    let endDate = today;

    // For daily, only today's data
    if (period === 'daily') {
      startDate = today;
      endDate = today;
    }

    // Get all submissions for this user in the period
    const { data, error } = await supabase
      .from('fitcircle_data_submissions')
      .select('steps, submitted_at')
      .eq('user_id', userId)
      .eq('fitcircle_id', fitcircleId)
      .gte('submission_date', startDate)
      .lte('submission_date', endDate)
      .order('submitted_at', { ascending: false });

    if (error || !data || data.length === 0) {
      return { value: 0, timestamp: null };
    }

    // Sum all steps
    const totalSteps = data.reduce((sum, d) => sum + (d.steps || 0), 0);
    const latestTimestamp = data[0].submitted_at;

    return { value: totalSteps, timestamp: latestTimestamp };
  } catch (error) {
    return { value: 0, timestamp: null };
  }
}

/**
 * Calculate weight loss percentage for a user
 * Formula: (starting_weight - current_weight) / (starting_weight - target_weight) * 100
 */
export async function calculateWeightLossMetric(
  userId: string,
  fitcircleId: string,
  supabase: SupabaseClient
): Promise<{ value: number; timestamp: string | null }> {
  try {
    // Get challenge details for starting and target weight
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('id, start_date')
      .eq('circle_id', fitcircleId)
      .eq('type', 'weight_loss')
      .single();

    if (challengeError || !challenge) {
      return { value: 0, timestamp: null };
    }

    // Get starting weight (from challenge start date)
    const { data: startTracking } = await supabase
      .from('daily_tracking')
      .select('weight_kg, tracking_date')
      .eq('user_id', userId)
      .gte('tracking_date', challenge.start_date)
      .order('tracking_date', { ascending: true })
      .limit(1)
      .single();

    if (!startTracking || !startTracking.weight_kg) {
      return { value: 0, timestamp: null };
    }

    const startingWeight = startTracking.weight_kg;

    // Get current weight (most recent)
    const { data: currentTracking } = await supabase
      .from('daily_tracking')
      .select('weight_kg, tracking_date')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false })
      .limit(1)
      .single();

    if (!currentTracking || !currentTracking.weight_kg) {
      return { value: 0, timestamp: null };
    }

    const currentWeight = currentTracking.weight_kg;

    // Get target weight (from challenge participants)
    const { data: participant } = await supabase
      .from('challenge_participants')
      .select('target_weight')
      .eq('challenge_id', challenge.id)
      .eq('user_id', userId)
      .single();

    if (!participant || !participant.target_weight) {
      // If no target, just calculate % lost from start
      const percentLost = ((startingWeight - currentWeight) / startingWeight) * 100;
      return {
        value: Math.max(0, percentLost),
        timestamp: currentTracking.tracking_date,
      };
    }

    const targetWeight = participant.target_weight;

    // Calculate percentage toward goal
    const weightLost = startingWeight - currentWeight;
    const totalWeightToLose = startingWeight - targetWeight;

    if (totalWeightToLose <= 0) {
      return { value: 0, timestamp: currentTracking.tracking_date };
    }

    const percentage = (weightLost / totalWeightToLose) * 100;

    return {
      value: Math.max(0, Math.min(100, percentage)), // Clamp between 0-100
      timestamp: currentTracking.tracking_date,
    };
  } catch (error) {
    return { value: 0, timestamp: null };
  }
}

// ============================================================================
// LEADERBOARD CALCULATION
// ============================================================================

/**
 * Recalculate leaderboard for a FitCircle and period
 */
export async function recalculateLeaderboard(
  fitcircleId: string,
  period: LeaderboardPeriod,
  metricType: MetricType,
  supabase: SupabaseClient
): Promise<{ entries: LeaderboardEntry[]; error: Error | null }> {
  try {
    const periodStart = getPeriodStart(period);

    // Get all active members of the FitCircle
    const { data: members, error: membersError } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', fitcircleId)
      .eq('is_active', true);

    if (membersError || !members) {
      return { entries: [], error: new Error('Failed to fetch members') };
    }

    // Calculate metrics for each member
    const stats: LeaderboardStats[] = [];
    for (const member of members) {
      let metric: { value: number; timestamp: string | null };

      if (metricType === 'steps') {
        metric = await calculateStepsMetric(member.user_id, fitcircleId, period, periodStart, supabase);
      } else if (metricType === 'weight_loss_pct') {
        metric = await calculateWeightLossMetric(member.user_id, fitcircleId, supabase);
      } else {
        // checkin_streak - use engagement_streaks table
        const { data: streak } = await supabase
          .from('engagement_streaks')
          .select('current_streak, last_checkin_date')
          .eq('user_id', member.user_id)
          .single();

        metric = {
          value: streak?.current_streak || 0,
          timestamp: streak?.last_checkin_date || null,
        };
      }

      stats.push({
        user_id: member.user_id,
        metric_value: metric.value,
        submission_timestamp: metric.timestamp || undefined,
      });
    }

    // Sort by metric value (desc), then by timestamp (asc = earliest wins ties)
    stats.sort((a, b) => {
      if (b.metric_value !== a.metric_value) {
        return b.metric_value - a.metric_value;
      }
      // Tie-breaking: earlier timestamp wins
      const timeA = a.submission_timestamp ? new Date(a.submission_timestamp).getTime() : Infinity;
      const timeB = b.submission_timestamp ? new Date(b.submission_timestamp).getTime() : Infinity;
      return timeA - timeB;
    });

    // Get previous rankings for rank_change calculation
    const { data: previousEntries } = await supabase
      .from('fitcircle_leaderboard_entries')
      .select('user_id, rank')
      .eq('fitcircle_id', fitcircleId)
      .eq('period', period)
      .eq('period_start', periodStart);

    const previousRankMap = new Map(
      (previousEntries || []).map(e => [e.user_id, e.rank])
    );

    // Assign ranks and create/update entries
    const entries: Array<Omit<LeaderboardEntry, 'id' | 'created_at'>> = stats.map((stat, index) => {
      const newRank = index + 1;
      const previousRank = previousRankMap.get(stat.user_id) || newRank;
      const rankChange = previousRank - newRank; // Positive = moved up, negative = moved down

      return {
        fitcircle_id: fitcircleId,
        user_id: stat.user_id,
        period,
        period_start: periodStart,
        metric_type: metricType,
        metric_value: stat.metric_value,
        rank: newRank,
        rank_change: rankChange,
        last_updated: new Date().toISOString(),
      };
    });

    // Upsert all entries
    const { data, error } = await supabase
      .from('fitcircle_leaderboard_entries')
      .upsert(entries, {
        onConflict: 'fitcircle_id,user_id,period,period_start',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      return { entries: [], error: new Error(error.message) };
    }

    return { entries: data || [], error: null };
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get leaderboard for a FitCircle and period
 */
export async function getLeaderboard(
  fitcircleId: string,
  period: LeaderboardPeriod,
  supabase: SupabaseClient
): Promise<{ entries: LeaderboardEntryWithProfile[]; error: Error | null }> {
  try {
    const periodStart = getPeriodStart(period);

    const { data, error } = await supabase
      .from('fitcircle_leaderboard_entries')
      .select(`
        *,
        profile:user_id (
          username,
          display_name,
          avatar_url
        )
      `)
      .eq('fitcircle_id', fitcircleId)
      .eq('period', period)
      .eq('period_start', periodStart)
      .order('rank', { ascending: true });

    if (error) {
      return { entries: [], error: new Error(error.message) };
    }

    if (!data || data.length === 0) {
      // No entries exist - trigger recalculation
      // Determine metric type from challenge type
      const { data: challenge } = await supabase
        .from('challenges')
        .select('type')
        .eq('circle_id', fitcircleId)
        .single();

      const metricType: MetricType = challenge?.type === 'weight_loss' ? 'weight_loss_pct' : 'steps';

      const { entries: newEntries, error: recalcError } = await recalculateLeaderboard(
        fitcircleId,
        period,
        metricType,
        supabase
      );

      if (recalcError) {
        return { entries: [], error: recalcError };
      }

      // Fetch with profiles
      const { data: withProfiles, error: profileError } = await supabase
        .from('fitcircle_leaderboard_entries')
        .select(`
          *,
          profile:user_id (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('fitcircle_id', fitcircleId)
        .eq('period', period)
        .eq('period_start', periodStart)
        .order('rank', { ascending: true });

      if (profileError) {
        return { entries: [], error: new Error(profileError.message) };
      }

      return { entries: withProfiles || [], error: null };
    }

    return { entries: data, error: null };
  } catch (error) {
    return {
      entries: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get user's rank across all periods in a FitCircle
 */
export async function getUserRankings(
  userId: string,
  fitcircleId: string,
  supabase: SupabaseClient
): Promise<{
  daily: LeaderboardEntry | null;
  weekly: LeaderboardEntry | null;
  monthly: LeaderboardEntry | null;
  all_time: LeaderboardEntry | null;
  error: Error | null;
}> {
  try {
    const periods: LeaderboardPeriod[] = ['daily', 'weekly', 'monthly', 'all_time'];
    const rankings: Record<LeaderboardPeriod, LeaderboardEntry | null> = {
      daily: null,
      weekly: null,
      monthly: null,
      all_time: null,
    };

    for (const period of periods) {
      const periodStart = getPeriodStart(period);

      const { data, error } = await supabase
        .from('fitcircle_leaderboard_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('fitcircle_id', fitcircleId)
        .eq('period', period)
        .eq('period_start', periodStart)
        .single();

      if (!error && data) {
        rankings[period] = data;
      }
    }

    return { ...rankings, error: null };
  } catch (error) {
    return {
      daily: null,
      weekly: null,
      monthly: null,
      all_time: null,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Update user's leaderboard entry after data submission
 * This is a lightweight incremental update (doesn't recalculate all members)
 */
export async function updateUserRankAfterSubmission(
  userId: string,
  fitcircleId: string,
  submittedSteps: number,
  supabase: SupabaseClient
): Promise<{ newRank: number | null; rankChange: number; error: Error | null }> {
  try {
    // For simplicity, trigger full leaderboard recalculation for daily period
    // In production, this could be optimized with incremental updates
    const { entries, error } = await recalculateLeaderboard(fitcircleId, 'daily', 'steps', supabase);

    if (error) {
      return { newRank: null, rankChange: 0, error };
    }

    const userEntry = entries.find(e => e.user_id === userId);

    if (!userEntry) {
      return { newRank: null, rankChange: 0, error: new Error('User not found in leaderboard') };
    }

    return {
      newRank: userEntry.rank,
      rankChange: userEntry.rank_change,
      error: null,
    };
  } catch (error) {
    return {
      newRank: null,
      rankChange: 0,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

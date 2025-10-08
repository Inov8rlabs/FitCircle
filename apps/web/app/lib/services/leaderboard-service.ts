import { createServerSupabase } from '@/lib/supabase-server';
import { SupabaseClient } from '@supabase/supabase-js';

interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  current_value: number;
  starting_value: number;
  target_value: number;
  progress_percentage: number;
  latest_entry_date: string | null;
  total_entries: number;
  is_creator: boolean;
  rank: number;
}

interface Challenge {
  id: string;
  type: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
  start_date: string;
  end_date: string;
  creator_id: string;
  leaderboard_update_frequency?: 'daily' | 'weekly' | 'realtime';
  leaderboard_update_day?: number; // 0-6 for Sunday-Saturday
  leaderboard_update_time?: string; // HH:MM in ET
}

export class LeaderboardService {
  /**
   * Get leaderboard data for a challenge by pulling from daily_tracking
   */
  static async getLeaderboard(
    challengeId: string,
    supabase?: SupabaseClient
  ): Promise<LeaderboardEntry[]> {
    const client = supabase || (await createServerSupabase());

    // Get challenge details
    const { data: challenge, error: challengeError } = await client
      .from('challenges')
      .select('*')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      console.error('Error fetching challenge:', challengeError);
      return [];
    }

    // Get all active participants with their profile goals
    const { data: participants, error: participantsError } = await client
      .from('challenge_participants')
      .select(`
        user_id,
        status,
        starting_value,
        goal_value,
        profiles!challenge_participants_user_id_fkey (
          display_name,
          avatar_url,
          goals
        )
      `)
      .eq('challenge_id', challengeId)
      .eq('status', 'active');

    if (participantsError || !participants) {
      console.error('Error fetching participants:', participantsError);
      return [];
    }

    // Get the relevant tracking data for each participant
    const leaderboardData = await Promise.all(
      participants.map(async (participant: any) => {
        const trackingData = await this.getParticipantProgress(
          participant.user_id,
          challenge,
          client
        );

        // Get goal from profile if not set in participant record
        let goalValue = participant.goal_value;
        let startingValue = participant.starting_value;

        if (!goalValue && participant.profiles?.goals) {
          const profileGoals = Array.isArray(participant.profiles.goals)
            ? participant.profiles.goals
            : participant.profiles?.[0]?.goals || [];

          const weightGoal = profileGoals.find((g: any) => g.type === 'weight');
          if (weightGoal) {
            goalValue = weightGoal.target_weight_kg;
            startingValue = startingValue || weightGoal.starting_weight_kg;
          }
        }

        // Use tracking data for starting value if we have it
        const finalStartingValue = trackingData.starting_value || startingValue || trackingData.current_value || 0;
        const finalGoalValue = goalValue || 0;

        console.log('Leaderboard entry for user:', participant.user_id, {
          trackingDataStarting: trackingData.starting_value,
          trackingDataCurrent: trackingData.current_value,
          participantStarting: participant.starting_value,
          participantGoal: participant.goal_value,
          profileGoal: goalValue,
          finalStarting: finalStartingValue,
          finalCurrent: trackingData.current_value,
          finalGoal: finalGoalValue,
          totalEntries: trackingData.total_entries
        });

        return {
          user_id: participant.user_id,
          display_name: participant.profiles?.display_name || participant.profiles?.[0]?.display_name || 'Unknown User',
          avatar_url: participant.profiles?.avatar_url || participant.profiles?.[0]?.avatar_url || null,
          current_value: trackingData.current_value,
          starting_value: finalStartingValue,
          target_value: finalGoalValue,
          progress_percentage: this.calculateProgress(
            finalStartingValue,
            trackingData.current_value,
            finalGoalValue,
            challenge.type
          ),
          latest_entry_date: trackingData.latest_date,
          total_entries: trackingData.total_entries,
          is_creator: participant.user_id === challenge.creator_id,
          rank: 0, // Will be calculated after sorting
        };
      })
    );

    // Sort by progress (descending) and assign ranks
    const sorted = leaderboardData.sort(
      (a, b) => b.progress_percentage - a.progress_percentage
    );

    sorted.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return sorted;
  }

  /**
   * Get a participant's progress from daily_tracking
   */
  static async getParticipantProgress(
    userId: string,
    challenge: Challenge,
    supabase: SupabaseClient
  ): Promise<{
    current_value: number;
    starting_value: number | null;
    latest_date: string | null;
    total_entries: number;
  }> {
    const challengeType = challenge.type;
    const startDate = challenge.start_date;
    const endDate = challenge.end_date;

    // Map challenge type to daily_tracking column
    const columnMap: Record<string, string> = {
      weight_loss: 'weight_kg',
      step_count: 'steps',
      workout_frequency: 'workout_minutes',
      custom: 'weight_kg', // fallback
    };

    const column = columnMap[challengeType] || 'weight_kg';

    console.log('Getting participant progress:', {
      userId,
      challengeType,
      column,
      startDate,
      endDate
    });

    // Get all entries within the challenge period
    const { data: entries, error } = await supabase
      .from('daily_tracking')
      .select(`tracking_date, ${column}`)
      .eq('user_id', userId)
      .gte('tracking_date', startDate)
      .lte('tracking_date', endDate)
      .not(column, 'is', null)
      .order('tracking_date', { ascending: true });

    console.log('Tracking entries found:', entries?.length || 0, error);

    if (error || !entries || entries.length === 0) {
      return {
        current_value: 0,
        starting_value: null,
        latest_date: null,
        total_entries: 0,
      };
    }

    // Get starting value: Look for the most recent entry BEFORE challenge start
    // If none exists, use the first entry in the challenge period
    const { data: baselineEntry } = await supabase
      .from('daily_tracking')
      .select(`tracking_date, ${column}`)
      .eq('user_id', userId)
      .lt('tracking_date', startDate)
      .not(column, 'is', null)
      .order('tracking_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const rawStartingValue = baselineEntry?.[column as keyof typeof baselineEntry]
      || entries[0]?.[column as keyof typeof entries[0]]
      || null;

    // Convert to number if not null/undefined, ensure proper typing
    const startingValue = rawStartingValue !== null && rawStartingValue !== undefined
      ? Number(rawStartingValue)
      : null;

    console.log('Starting value calculation:', {
      baselineEntry: baselineEntry?.[column as keyof typeof baselineEntry],
      firstChallengeEntry: entries[0]?.[column as keyof typeof entries[0]],
      rawStartingValue,
      finalStartingValue: startingValue
    });

    // Get latest value based on leaderboard update frequency
    const latestValue = this.getLatestValueForFrequency(
      entries,
      column,
      challenge.leaderboard_update_frequency || 'realtime',
      challenge.leaderboard_update_day,
      challenge.leaderboard_update_time
    );

    return {
      current_value: latestValue.value,
      starting_value: startingValue,
      latest_date: latestValue.date,
      total_entries: entries.length,
    };
  }

  /**
   * Get the latest value based on leaderboard update frequency
   */
  static getLatestValueForFrequency(
    entries: any[],
    column: string,
    frequency: string,
    updateDay?: number,
    updateTime?: string
  ): { value: number; date: string | null } {
    if (entries.length === 0) {
      return { value: 0, date: null };
    }

    // For realtime, just use the latest entry
    if (frequency === 'realtime' || frequency === 'daily') {
      const latest = entries[entries.length - 1];
      return {
        value: latest[column] || 0,
        date: latest.tracking_date,
      };
    }

    // For weekly, find the last entry before the weekly update time
    if (frequency === 'weekly' && updateDay !== undefined) {
      const now = new Date();
      const targetDay = updateDay; // 0 = Sunday, 1 = Monday, etc.

      // Find the most recent update day
      let mostRecentUpdateDate = new Date(now);
      const currentDay = now.getDay();
      const daysToSubtract = (currentDay - targetDay + 7) % 7;
      mostRecentUpdateDate.setDate(now.getDate() - daysToSubtract);

      // Filter entries before the update date/time
      const validEntries = entries.filter((entry) => {
        const entryDate = new Date(entry.tracking_date);
        return entryDate <= mostRecentUpdateDate;
      });

      if (validEntries.length === 0) {
        const latest = entries[entries.length - 1];
        return { value: latest[column] || 0, date: latest.tracking_date };
      }

      const latest = validEntries[validEntries.length - 1];
      return {
        value: latest[column] || 0,
        date: latest.tracking_date,
      };
    }

    // Default: return latest
    const latest = entries[entries.length - 1];
    return {
      value: latest[column] || 0,
      date: latest.tracking_date,
    };
  }

  /**
   * Calculate progress percentage based on challenge type
   */
  static calculateProgress(
    startValue: number,
    currentValue: number,
    targetValue: number,
    challengeType: string
  ): number {
    if (targetValue === 0) return 0;

    // For weight loss, progress is: (starting - current) / (starting - target) * 100
    if (challengeType === 'weight_loss') {
      const totalToLose = startValue - targetValue;
      if (totalToLose <= 0) return 0;

      // If no progress logged (currentValue is 0), treat as no progress made (0%)
      const effectiveCurrentValue = currentValue > 0 ? currentValue : startValue;
      const lostSoFar = startValue - effectiveCurrentValue;
      return Math.max(0, Math.min(100, (lostSoFar / totalToLose) * 100));
    }

    // For step count and workout frequency, progress is: current / target * 100
    if (challengeType === 'step_count' || challengeType === 'workout_frequency') {
      return Math.max(0, Math.min(100, (currentValue / targetValue) * 100));
    }

    // Default calculation
    return 0;
  }

  /**
   * Check if leaderboard should update now based on frequency settings
   */
  static shouldUpdateLeaderboard(
    frequency: string = 'realtime',
    updateDay?: number,
    updateTime?: string
  ): boolean {
    if (frequency === 'realtime') return true;
    if (frequency === 'daily') return true; // Can update anytime during the day

    if (frequency === 'weekly' && updateDay !== undefined && updateTime) {
      const now = new Date();
      const currentDay = now.getDay();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

      // Check if it's the right day and within the update window (12 hours)
      if (currentDay === updateDay) {
        // Simple time comparison (would need timezone handling in production)
        return currentTime >= updateTime;
      }
    }

    return false;
  }
}

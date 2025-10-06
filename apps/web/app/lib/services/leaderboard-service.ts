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

    // Get all active participants
    const { data: participants, error: participantsError } = await client
      .from('challenge_participants')
      .select(`
        user_id,
        status,
        starting_value,
        goal_value,
        profiles!challenge_participants_user_id_fkey (
          display_name,
          avatar_url
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

        return {
          user_id: participant.user_id,
          display_name: participant.profiles?.display_name || participant.profiles?.[0]?.display_name || 'Unknown User',
          avatar_url: participant.profiles?.avatar_url || participant.profiles?.[0]?.avatar_url || null,
          current_value: trackingData.current_value,
          starting_value: trackingData.starting_value || participant.starting_value || 0,
          target_value: participant.goal_value || 0,
          progress_percentage: this.calculateProgress(
            trackingData.starting_value || participant.starting_value || 0,
            trackingData.current_value,
            participant.goal_value || 0,
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
      weight_loss: 'weight',
      step_count: 'steps',
      workout_frequency: 'workout_minutes',
      custom: 'weight', // fallback
    };

    const column = columnMap[challengeType] || 'weight';

    // Get all entries within the challenge period
    const { data: entries, error } = await supabase
      .from('daily_tracking')
      .select(`date, ${column}`)
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .not(column, 'is', null)
      .order('date', { ascending: true });

    if (error || !entries || entries.length === 0) {
      return {
        current_value: 0,
        starting_value: null,
        latest_date: null,
        total_entries: 0,
      };
    }

    // Get starting value (first entry in challenge period)
    const startingValue = entries[0]?.[column] || null;

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
        date: latest.date,
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
        const entryDate = new Date(entry.date);
        return entryDate <= mostRecentUpdateDate;
      });

      if (validEntries.length === 0) {
        const latest = entries[entries.length - 1];
        return { value: latest[column] || 0, date: latest.date };
      }

      const latest = validEntries[validEntries.length - 1];
      return {
        value: latest[column] || 0,
        date: latest.date,
      };
    }

    // Default: return latest
    const latest = entries[entries.length - 1];
    return {
      value: latest[column] || 0,
      date: latest.date,
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
      const lostSoFar = startValue - currentValue;
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

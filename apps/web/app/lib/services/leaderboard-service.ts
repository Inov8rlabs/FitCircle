import { type SupabaseClient } from '@supabase/supabase-js';

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
    _supabase?: SupabaseClient
  ): Promise<LeaderboardEntry[]> {
    // Cross-user leaderboard data (other members' goals / tracking) is no longer
    // readable by the browser anon-key client (migration 069). It is served by
    // the service-role /api/fitcircles/[id]/leaderboard route, which authorizes
    // the caller and reads via the admin client. The `_supabase` param is kept
    // for signature stability but is no longer used.
    try {
      const response = await fetch(`/api/fitcircles/${challengeId}/leaderboard`);

      if (!response.ok) {
        console.error('Error fetching leaderboard:', response.status, response.statusText);
        return [];
      }

      const data = await response.json();
      const entries = (data.leaderboard || []) as any[];

      return entries.map((entry, index): LeaderboardEntry => ({
        user_id: entry.user_id,
        display_name: entry.display_name || 'Unknown User',
        avatar_url: entry.avatar_url ?? null,
        current_value: entry.current_value ?? 0,
        starting_value: entry.starting_value ?? 0,
        target_value: entry.target_value ?? 0,
        progress_percentage: entry.progress_percentage ?? 0,
        latest_entry_date: entry.latest_entry_date ?? entry.last_check_in_at ?? null,
        total_entries: entry.total_entries ?? 0,
        is_creator: entry.is_creator ?? false,
        rank: entry.rank ?? index + 1,
      }));
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      return [];
    }
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
      const mostRecentUpdateDate = new Date(now);
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

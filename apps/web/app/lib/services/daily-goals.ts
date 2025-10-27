/**
 * Daily Goals Service
 *
 * Business logic for the Daily Progress Meter feature including:
 * - Daily goal calculation from FitCircle challenges
 * - Goal recommendation algorithms
 * - Daily progress tracking
 * - Streak calculation
 * - Goal completion history
 *
 * Spec: /docs/DAILY-PROGRESS-METER-SPEC.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from '@/lib/supabase';

// Types
export type GoalType = 'steps' | 'weight_log' | 'workout' | 'mood' | 'energy' | 'custom';
export type GoalFrequency = 'daily' | 'weekdays' | 'weekends' | 'custom';
export type ChallengeType = 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';

export interface DailyGoal {
  id: string;
  user_id: string;
  challenge_id: string | null;
  goal_type: GoalType;
  target_value: number | null;
  unit: string | null;
  start_date: string;
  end_date: string | null;
  frequency: GoalFrequency;
  custom_schedule: any | null;
  is_active: boolean;
  is_primary: boolean;
  auto_adjust_enabled: boolean;
  baseline_value: number | null;
  adjustment_algorithm: string | null;
  last_adjusted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalCompletion {
  id: string;
  user_id: string;
  daily_goal_id: string;
  completion_date: string;
  target_value: number | null;
  actual_value: number | null;
  completion_percentage: number;
  is_completed: boolean;
  completed_at: string | null;
  logged_at: string;
  notes: string | null;
  created_at: string;
}

export interface Challenge {
  id: string;
  type: ChallengeType;
  start_date: string;
  end_date: string;
}

export interface ChallengeParticipant {
  starting_weight_kg: number | null;
  goal_weight_kg: number | null;
  starting_value: number | null;
  goal_value: number | null;
}

export interface DailyProgress {
  date: string;
  goals: GoalProgress[];
  overall_completion: number;
  total_goals: number;
  completed_goals: number;
}

export interface GoalProgress {
  goal_id: string;
  goal_type: GoalType;
  target_value: number | null;
  actual_value: number | null;
  completion_percentage: number;
  is_completed: boolean;
  unit: string | null;
}

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  last_completion_date: string | null;
}

/**
 * Daily Goal Service - All business logic for daily goals
 */
export class DailyGoalService {
  /**
   * Calculate daily step goal from a challenge
   *
   * Formula (from spec section 2.2):
   * - Weight loss challenges: Calculate calorie deficit needed, convert to steps
   * - Step challenges: Total steps / duration
   * - Fallback: Conservative defaults based on goal difficulty
   */
  static calculateDailyStepGoal(
    challenge: Challenge,
    participant: ChallengeParticipant,
    userBaseline: number = 5000
  ): number {
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);
    const durationDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (challenge.type === 'step_count' && participant.goal_value) {
      // Step challenge: divide total by duration
      const dailySteps = Math.ceil(participant.goal_value / durationDays);
      // Cap at reasonable limits
      return Math.min(Math.max(dailySteps, 5000), 25000);
    }

    if (challenge.type === 'weight_loss' && participant.starting_weight_kg && participant.goal_weight_kg) {
      // Weight loss challenge: calculate from calorie deficit
      const weightToLose = participant.starting_weight_kg - participant.goal_weight_kg;

      // 1 kg fat ≈ 7700 calories
      const totalCalorieDeficit = weightToLose * 7700;
      const dailyCalorieDeficit = totalCalorieDeficit / durationDays;

      // Aim for 40% of deficit from increased activity (steps)
      // Each 1000 steps ≈ 40-50 calories (using 45)
      const caloriesFromSteps = dailyCalorieDeficit * 0.4;
      const additionalSteps = Math.ceil(caloriesFromSteps / 0.045);

      const dailySteps = userBaseline + additionalSteps;

      // Conservative limits (from spec)
      if (weightToLose < 2.5) return 8000; // Light goal
      if (weightToLose < 7) return 10000;  // Moderate goal
      return Math.min(12000, dailySteps);   // Aggressive goal
    }

    // Fallback: moderate default
    return 10000;
  }

  /**
   * Calculate daily weight log goal
   *
   * For weight loss challenges, daily weight logging is recommended
   */
  static calculateDailyWeightGoal(
    challenge: Challenge,
    participant: ChallengeParticipant
  ): { shouldLog: boolean; targetWeight: number | null } {
    if (challenge.type === 'weight_loss' && participant.goal_weight_kg) {
      return {
        shouldLog: true,
        targetWeight: participant.goal_weight_kg,
      };
    }

    return {
      shouldLog: false,
      targetWeight: null,
    };
  }

  /**
   * Create daily goals for a user when they join a challenge
   */
  static async createDailyGoalsForChallenge(
    userId: string,
    challengeId: string,
    supabaseClient?: SupabaseClient
  ): Promise<{ success: boolean; goals: DailyGoal[]; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      // 1. Fetch challenge details
      const { data: challenge, error: challengeError } = await supabase
        .from('challenges')
        .select('id, type, start_date, end_date')
        .eq('id', challengeId)
        .single();

      if (challengeError || !challenge) {
        return { success: false, goals: [], error: new Error('Challenge not found') };
      }

      // 2. Fetch participant details
      const { data: participant, error: participantError } = await supabase
        .from('challenge_participants')
        .select('starting_weight_kg, goal_weight_kg, starting_value, goal_value')
        .eq('user_id', userId)
        .eq('challenge_id', challengeId)
        .single();

      if (participantError || !participant) {
        return { success: false, goals: [], error: new Error('Participant not found') };
      }

      // 3. Calculate user's baseline activity
      const { data: recentTracking } = await supabase
        .from('daily_tracking')
        .select('steps')
        .eq('user_id', userId)
        .not('steps', 'is', null)
        .order('tracking_date', { ascending: false })
        .limit(7);

      const userBaseline = recentTracking && recentTracking.length > 0
        ? Math.floor(recentTracking.reduce((sum, t) => sum + (t.steps || 0), 0) / recentTracking.length)
        : 5000;

      // 4. Create goals based on challenge type
      const goalsToCreate: Partial<DailyGoal>[] = [];

      // Steps goal
      if (challenge.type === 'step_count' || challenge.type === 'weight_loss') {
        const dailySteps = this.calculateDailyStepGoal(challenge, participant, userBaseline);
        goalsToCreate.push({
          user_id: userId,
          challenge_id: challengeId,
          goal_type: 'steps',
          target_value: dailySteps,
          unit: 'steps',
          start_date: challenge.start_date,
          end_date: challenge.end_date,
          frequency: 'daily',
          is_primary: true, // First goal is primary
          baseline_value: userBaseline,
        });
      }

      // Weight logging goal
      if (challenge.type === 'weight_loss') {
        const weightGoal = this.calculateDailyWeightGoal(challenge, participant);
        if (weightGoal.shouldLog) {
          goalsToCreate.push({
            user_id: userId,
            challenge_id: challengeId,
            goal_type: 'weight_log',
            target_value: 1, // Binary: log weight once per day
            unit: 'log',
            start_date: challenge.start_date,
            end_date: challenge.end_date,
            frequency: 'daily',
            is_primary: goalsToCreate.length === 0, // Primary if no other goals
          });
        }
      }

      // 5. Insert goals
      const { data: createdGoals, error: insertError } = await supabase
        .from('daily_goals')
        .insert(goalsToCreate)
        .select();

      if (insertError) {
        return { success: false, goals: [], error: new Error(insertError.message) };
      }

      return { success: true, goals: createdGoals || [], error: null };
    } catch (error) {
      return {
        success: false,
        goals: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get active daily goals for a user
   */
  static async getUserDailyGoals(
    userId: string,
    supabaseClient?: SupabaseClient
  ): Promise<{ data: DailyGoal[]; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('daily_goals')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .lte('start_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      return { data: data || [], error: null };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Update goal completion based on daily tracking data
   */
  static async updateGoalCompletion(
    userId: string,
    date: string,
    trackingData: {
      steps?: number;
      weight_kg?: number;
      mood_score?: number;
      energy_level?: number;
    },
    supabaseClient?: SupabaseClient
  ): Promise<{ success: boolean; completions: GoalCompletion[]; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      // 1. Get active daily goals for this date
      const { data: goals, error: goalsError } = await supabase
        .from('daily_goals')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .lte('start_date', date)
        .or(`end_date.is.null,end_date.gte.${date}`);

      if (goalsError || !goals) {
        return { success: false, completions: [], error: new Error('Failed to fetch goals') };
      }

      // 2. Calculate completion for each goal
      const completions: Partial<GoalCompletion>[] = [];
      const now = new Date().toISOString();

      for (const goal of goals) {
        let actualValue: number | null = null;
        let completionPercentage = 0;
        let completedAt: string | null = null;

        switch (goal.goal_type) {
          case 'steps':
            actualValue = trackingData.steps || null;
            if (actualValue !== null && goal.target_value) {
              completionPercentage = Math.min((actualValue / goal.target_value) * 100, 100);
              if (completionPercentage >= 100) completedAt = now;
            }
            break;

          case 'weight_log':
            actualValue = trackingData.weight_kg !== undefined ? 1 : 0;
            completionPercentage = actualValue === 1 ? 100 : 0;
            if (completionPercentage >= 100) completedAt = now;
            break;

          case 'mood':
            actualValue = trackingData.mood_score || null;
            completionPercentage = actualValue !== null ? 100 : 0;
            if (completionPercentage >= 100) completedAt = now;
            break;

          case 'energy':
            actualValue = trackingData.energy_level || null;
            completionPercentage = actualValue !== null ? 100 : 0;
            if (completionPercentage >= 100) completedAt = now;
            break;
        }

        completions.push({
          user_id: userId,
          daily_goal_id: goal.id,
          completion_date: date,
          target_value: goal.target_value,
          actual_value: actualValue,
          completion_percentage: parseFloat(completionPercentage.toFixed(2)),
          completed_at: completedAt,
        });
      }

      // 3. Upsert completion history
      const { data: savedCompletions, error: upsertError } = await supabase
        .from('goal_completion_history')
        .upsert(completions, {
          onConflict: 'user_id,daily_goal_id,completion_date',
        })
        .select();

      if (upsertError) {
        return { success: false, completions: [], error: new Error(upsertError.message) };
      }

      return { success: true, completions: savedCompletions || [], error: null };
    } catch (error) {
      return {
        success: false,
        completions: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get today's progress for a user
   */
  static async getTodayProgress(
    userId: string,
    supabaseClient?: SupabaseClient
  ): Promise<{ data: DailyProgress | null; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();
    const today = new Date().toISOString().split('T')[0];

    try {
      // 1. Get active goals
      const { data: goals } = await this.getUserDailyGoals(userId, supabase);

      // 2. Get today's tracking data
      const { data: tracking } = await supabase
        .from('daily_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('tracking_date', today)
        .maybeSingle();

      // 3. Get completion history for today
      const { data: completions } = await supabase
        .from('goal_completion_history')
        .select('*')
        .eq('user_id', userId)
        .eq('completion_date', today);

      // 4. Build progress response
      const goalProgress: GoalProgress[] = goals.map(goal => {
        const completion = completions?.find(c => c.daily_goal_id === goal.id);

        let actualValue: number | null = null;
        if (tracking) {
          switch (goal.goal_type) {
            case 'steps':
              actualValue = tracking.steps;
              break;
            case 'weight_log':
              actualValue = tracking.weight_kg !== null ? 1 : 0;
              break;
            case 'mood':
              actualValue = tracking.mood_score;
              break;
            case 'energy':
              actualValue = tracking.energy_level;
              break;
          }
        }

        return {
          goal_id: goal.id,
          goal_type: goal.goal_type,
          target_value: goal.target_value,
          actual_value: actualValue,
          completion_percentage: completion?.completion_percentage || 0,
          is_completed: completion?.is_completed || false,
          unit: goal.unit,
        };
      });

      const completedGoals = goalProgress.filter(g => g.is_completed).length;
      const totalGoals = goalProgress.length;
      const overallCompletion = totalGoals > 0 ? (completedGoals / totalGoals) * 100 : 0;

      return {
        data: {
          date: today,
          goals: goalProgress,
          overall_completion: parseFloat(overallCompletion.toFixed(2)),
          total_goals: totalGoals,
          completed_goals: completedGoals,
        },
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Calculate current streak for a user
   *
   * A streak is consecutive days where ALL daily goals were completed
   */
  static async calculateStreak(
    userId: string,
    supabaseClient?: SupabaseClient
  ): Promise<{ data: StreakInfo | null; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      // Get completion history ordered by date descending
      const { data: history, error: historyError } = await supabase
        .from('goal_completion_history')
        .select('completion_date, is_completed, daily_goal_id')
        .eq('user_id', userId)
        .order('completion_date', { ascending: false })
        .limit(365); // Look back up to 1 year

      if (historyError) {
        return { data: null, error: new Error(historyError.message) };
      }

      if (!history || history.length === 0) {
        return {
          data: {
            current_streak: 0,
            longest_streak: 0,
            last_completion_date: null,
          },
          error: null,
        };
      }

      // Group by date and check if all goals completed each day
      const dateCompletions = new Map<string, { total: number; completed: number }>();

      for (const record of history) {
        const date = record.completion_date;
        if (!dateCompletions.has(date)) {
          dateCompletions.set(date, { total: 0, completed: 0 });
        }
        const dayData = dateCompletions.get(date)!;
        dayData.total += 1;
        if (record.is_completed) {
          dayData.completed += 1;
        }
      }

      // Convert to array of dates where all goals were completed
      const completedDates = Array.from(dateCompletions.entries())
        .filter(([_, data]) => data.total > 0 && data.completed === data.total)
        .map(([date]) => date)
        .sort()
        .reverse();

      if (completedDates.length === 0) {
        return {
          data: {
            current_streak: 0,
            longest_streak: 0,
            last_completion_date: null,
          },
          error: null,
        };
      }

      // Calculate current streak (must be consecutive days up to today or yesterday)
      const today = new Date().toISOString().split('T')[0];
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let currentStreak = 0;
      let longestStreak = 0;
      let tempStreak = 0;

      // Check if most recent completion is today or yesterday
      if (completedDates[0] === today || completedDates[0] === yesterday) {
        let expectedDate = new Date(completedDates[0]);

        for (const date of completedDates) {
          const currentDate = new Date(date);
          const timeDiff = expectedDate.getTime() - currentDate.getTime();
          const dayDiff = Math.round(timeDiff / (1000 * 60 * 60 * 24));

          if (dayDiff === 0) {
            currentStreak++;
            tempStreak++;
            expectedDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
          } else if (dayDiff === 1) {
            tempStreak++;
            expectedDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
          } else {
            break;
          }
        }
      }

      // Calculate longest streak
      tempStreak = 0;
      let lastDate: Date | null = null;

      for (const date of completedDates.reverse()) {
        const currentDate = new Date(date);

        if (!lastDate) {
          tempStreak = 1;
        } else {
          const timeDiff = currentDate.getTime() - lastDate.getTime();
          const dayDiff = Math.round(timeDiff / (1000 * 60 * 60 * 24));

          if (dayDiff === 1) {
            tempStreak++;
          } else {
            longestStreak = Math.max(longestStreak, tempStreak);
            tempStreak = 1;
          }
        }

        lastDate = currentDate;
      }
      longestStreak = Math.max(longestStreak, tempStreak, currentStreak);

      return {
        data: {
          current_streak: currentStreak,
          longest_streak: longestStreak,
          last_completion_date: completedDates[0],
        },
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Get completion history for a user
   */
  static async getCompletionHistory(
    userId: string,
    limit: number = 30,
    supabaseClient?: SupabaseClient
  ): Promise<{ data: GoalCompletion[]; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      const { data, error } = await supabase
        .from('goal_completion_history')
        .select('*')
        .eq('user_id', userId)
        .order('completion_date', { ascending: false })
        .limit(limit);

      if (error) {
        return { data: [], error: new Error(error.message) };
      }

      return { data: data || [], error: null };
    } catch (error) {
      return {
        data: [],
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Adjust daily goal target
   */
  static async adjustGoalTarget(
    goalId: string,
    userId: string,
    newTarget: number,
    supabaseClient?: SupabaseClient
  ): Promise<{ success: boolean; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      const { error } = await supabase
        .from('daily_goals')
        .update({
          target_value: newTarget,
          last_adjusted_at: new Date().toISOString(),
        })
        .eq('id', goalId)
        .eq('user_id', userId); // Ensure ownership

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

  /**
   * Set primary goal for dashboard display
   */
  static async setPrimaryGoal(
    goalId: string,
    userId: string,
    supabaseClient?: SupabaseClient
  ): Promise<{ success: boolean; error: Error | null }> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      // First, unset all primary goals for this user
      await supabase
        .from('daily_goals')
        .update({ is_primary: false })
        .eq('user_id', userId);

      // Then set the new primary goal
      const { error } = await supabase
        .from('daily_goals')
        .update({ is_primary: true })
        .eq('id', goalId)
        .eq('user_id', userId);

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
}

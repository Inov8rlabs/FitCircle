/**
 * Goal Recommendation Service
 *
 * Provides intelligent goal recommendations based on:
 * - User's active FitCircle challenges
 * - Challenge types (weight loss, step count, workout frequency)
 * - General health recommendations (when no challenges active)
 *
 * Recommendations are contextual and explain WHY they're helpful
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase } from '@/lib/supabase';

export interface GoalRecommendation {
  goal_type: 'steps' | 'weight_log' | 'workout' | 'mood' | 'energy' | 'custom';
  target_value: number;
  unit: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  challenge_name?: string;
}

interface Challenge {
  id: string;
  name: string;
  challenge_type: string;
  target_value: number | null;
  duration_days: number;
  end_date: string;
}

export class GoalRecommendationService {
  /**
   * Get recommended goals based on user's active FitCircle challenges
   */
  static async getRecommendations(
    userId: string,
    supabaseClient?: SupabaseClient
  ): Promise<GoalRecommendation[]> {
    const supabase = supabaseClient || createAdminSupabase();

    try {
      // 1. Fetch user's active FitCircle challenges
      const challenges = await this.getUserActiveChallenges(userId, supabase);

      // 2. Generate recommendations based on challenge types
      const recommendations: GoalRecommendation[] = [];

      if (challenges.length > 0) {
        for (const challenge of challenges) {
          const challengeRecs = this.getRecommendationsForChallenge(challenge);
          recommendations.push(...challengeRecs);
        }
      } else {
        // 3. If no challenges, return general health recommendations
        recommendations.push(...this.getGeneralHealthRecommendations());
      }

      // 4. Deduplicate and prioritize
      return this.deduplicateAndPrioritize(recommendations);
    } catch (error) {
      console.error('Error generating goal recommendations:', error);
      // Return basic recommendations on error
      return this.getGeneralHealthRecommendations();
    }
  }

  /**
   * Get user's active challenges from FitCircles they've joined
   */
  private static async getUserActiveChallenges(
    userId: string,
    supabase: SupabaseClient
  ): Promise<Challenge[]> {
    const today = new Date().toISOString();

    // Get challenges through circle_participants
    const { data: participantData } = await supabase
      .from('circle_participants')
      .select(`
        circles!inner (
          id,
          name,
          challenge_type,
          target_value,
          duration_days,
          end_date
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('circles.end_date', today);

    if (!participantData || participantData.length === 0) {
      return [];
    }

    // Transform to Challenge array
    return participantData
      .map(p => {
        const circle = (p as any).circles;
        if (!circle) return null;

        return {
          id: circle.id,
          name: circle.name,
          challenge_type: circle.challenge_type,
          target_value: circle.target_value,
          duration_days: circle.duration_days,
          end_date: circle.end_date,
        };
      })
      .filter((c): c is Challenge => c !== null);
  }

  /**
   * Generate recommendations for a specific challenge
   */
  private static getRecommendationsForChallenge(
    challenge: Challenge
  ): GoalRecommendation[] {
    const recommendations: GoalRecommendation[] = [];

    switch (challenge.challenge_type) {
      case 'weight_loss':
        // Weight loss benefits from daily steps and weight tracking
        recommendations.push({
          goal_type: 'steps',
          target_value: 10000,
          unit: 'steps',
          reason: `Walking 10k steps daily helps with your "${challenge.name}" weight loss goal`,
          priority: 'high',
          challenge_name: challenge.name,
        });
        recommendations.push({
          goal_type: 'weight_log',
          target_value: 1,
          unit: 'times',
          reason: `Track your weight daily to monitor progress in "${challenge.name}"`,
          priority: 'high',
          challenge_name: challenge.name,
        });
        recommendations.push({
          goal_type: 'workout',
          target_value: 1,
          unit: 'sessions',
          reason: 'Strength training boosts metabolism for weight loss',
          priority: 'medium',
          challenge_name: challenge.name,
        });
        break;

      case 'step_count':
        // Step challenges need daily step goals
        const dailySteps = challenge.target_value && challenge.duration_days
          ? Math.round(challenge.target_value / challenge.duration_days)
          : 10000;

        recommendations.push({
          goal_type: 'steps',
          target_value: dailySteps,
          unit: 'steps',
          reason: `${dailySteps.toLocaleString()} daily steps to reach your "${challenge.name}" goal`,
          priority: 'high',
          challenge_name: challenge.name,
        });
        break;

      case 'workout_frequency':
        // Workout challenges need session tracking
        const dailyWorkouts = challenge.target_value && challenge.duration_days
          ? Math.ceil(challenge.target_value / challenge.duration_days)
          : 1;

        recommendations.push({
          goal_type: 'workout',
          target_value: dailyWorkouts,
          unit: 'sessions',
          reason: `Complete ${dailyWorkouts} workout${dailyWorkouts > 1 ? 's' : ''} daily for "${challenge.name}"`,
          priority: 'high',
          challenge_name: challenge.name,
        });
        recommendations.push({
          goal_type: 'steps',
          target_value: 8000,
          unit: 'steps',
          reason: 'Stay active on rest days to maintain momentum',
          priority: 'medium',
          challenge_name: challenge.name,
        });
        break;

      case 'custom':
      default:
        // For custom challenges, suggest general fitness goals
        recommendations.push({
          goal_type: 'steps',
          target_value: 8000,
          unit: 'steps',
          reason: `Stay consistent with daily activity for "${challenge.name}"`,
          priority: 'medium',
          challenge_name: challenge.name,
        });
        break;
    }

    return recommendations;
  }

  /**
   * Get general health recommendations (no active challenges)
   */
  private static getGeneralHealthRecommendations(): GoalRecommendation[] {
    return [
      {
        goal_type: 'steps',
        target_value: 8000,
        unit: 'steps',
        reason: 'WHO recommends 8,000-10,000 steps daily for heart health',
        priority: 'high',
      },
      {
        goal_type: 'weight_log',
        target_value: 1,
        unit: 'times',
        reason: 'Track your weight weekly to monitor health trends',
        priority: 'medium',
      },
      {
        goal_type: 'workout',
        target_value: 1,
        unit: 'sessions',
        reason: 'Regular exercise improves strength and energy levels',
        priority: 'medium',
      },
    ];
  }

  /**
   * Deduplicate recommendations and prioritize by importance
   */
  private static deduplicateAndPrioritize(
    recommendations: GoalRecommendation[]
  ): GoalRecommendation[] {
    // Group by goal type
    const grouped = new Map<string, GoalRecommendation>();

    for (const rec of recommendations) {
      const existing = grouped.get(rec.goal_type);

      if (!existing) {
        grouped.set(rec.goal_type, rec);
      } else {
        // Keep the higher priority recommendation
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        if (priorityOrder[rec.priority] > priorityOrder[existing.priority]) {
          grouped.set(rec.goal_type, rec);
        }
      }
    }

    // Convert back to array and sort by priority
    const deduplicated = Array.from(grouped.values());
    const priorityOrder = { high: 3, medium: 2, low: 1 };

    return deduplicated.sort(
      (a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]
    );
  }
}

/**
 * Goal Service
 *
 * Business logic for daily and weekly goal management including:
 * - Adaptive goal generation based on user baseline
 * - Goal progress tracking
 * - Baseline calculation from historical data
 * - Goal completion detection
 *
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export type GoalType = 'steps' | 'weight' | 'checkin' | 'workout' | 'water';
export type WeeklyGoalType = 'steps' | 'weight' | 'streak' | 'active_days';

export interface DailyGoal {
  id: string;
  user_id: string;
  date: string;
  goal_type: GoalType;
  target_value: number;
  actual_value: number;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeeklyGoal {
  id: string;
  user_id: string;
  week_start: string;
  goal_type: WeeklyGoalType;
  target_value: number;
  actual_value: number;
  daily_breakdown: Record<string, number>;
  completed: boolean;
  fitcircle_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserBaseline {
  averageSteps: number;
  averageWeight: number | null;
  checkInDays: number;
  totalDays: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_STEPS_SEDENTARY = 5000;
const DEFAULT_STEPS_MODERATE = 7000;
const ADAPTIVE_INCREASE_PERCENT = 0.10; // 10% increase over baseline
const MAX_DAILY_STEPS = 15000;
const BASELINE_CALCULATION_DAYS = 7;
const WEEKLY_STEPS_MULTIPLIER = 7;

// ============================================================================
// BASELINE CALCULATION
// ============================================================================

/**
 * Calculate user's baseline metrics from last 7 days of data
 * Used for adaptive goal generation
 */
export async function calculateUserBaseline(
  userId: string,
  supabase: SupabaseClient
): Promise<UserBaseline> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - BASELINE_CALCULATION_DAYS);

  const { data, error } = await supabase
    .from('daily_tracking')
    .select('steps, weight_kg, tracking_date')
    .eq('user_id', userId)
    .gte('tracking_date', sevenDaysAgo.toISOString().split('T')[0])
    .order('tracking_date', { ascending: false });

  if (error || !data || data.length === 0) {
    return {
      averageSteps: DEFAULT_STEPS_MODERATE,
      averageWeight: null,
      checkInDays: 0,
      totalDays: BASELINE_CALCULATION_DAYS,
    };
  }

  // Calculate average steps (only from days with step data)
  const stepsData = data.filter(d => d.steps !== null && d.steps > 0);
  const averageSteps = stepsData.length > 0
    ? Math.round(stepsData.reduce((sum, d) => sum + d.steps, 0) / stepsData.length)
    : DEFAULT_STEPS_MODERATE;

  // Calculate average weight (only from days with weight data)
  const weightData = data.filter(d => d.weight_kg !== null && d.weight_kg > 0);
  const averageWeight = weightData.length > 0
    ? weightData.reduce((sum, d) => sum + d.weight_kg, 0) / weightData.length
    : null;

  return {
    averageSteps: Math.min(averageSteps, MAX_DAILY_STEPS),
    averageWeight,
    checkInDays: data.length,
    totalDays: BASELINE_CALCULATION_DAYS,
  };
}

/**
 * Determine if user is new (less than 7 days of data)
 */
export function isNewUser(baseline: UserBaseline): boolean {
  return baseline.checkInDays < BASELINE_CALCULATION_DAYS;
}

// ============================================================================
// DAILY GOAL GENERATION
// ============================================================================

/**
 * Generate personalized daily goals for a user
 *
 * Logic:
 * - New users (< 7 days): Conservative defaults
 * - Established users: Baseline + 10% (adaptive)
 */
export async function generateDailyGoals(
  userId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ goals: DailyGoal[]; error: Error | null }> {
  try {
    // Get user baseline
    const baseline = await calculateUserBaseline(userId, supabase);
    const isNew = isNewUser(baseline);

    // Calculate goal targets
    const stepsTarget = isNew
      ? (baseline.averageSteps < 6000 ? DEFAULT_STEPS_SEDENTARY : DEFAULT_STEPS_MODERATE)
      : Math.min(
          Math.round(baseline.averageSteps * (1 + ADAPTIVE_INCREASE_PERCENT)),
          MAX_DAILY_STEPS
        );

    // Goals to generate
    const goalsToCreate: Array<{
      user_id: string;
      date: string;
      goal_type: GoalType;
      target_value: number;
      actual_value: number;
      completed: boolean;
    }> = [
      {
        user_id: userId,
        date,
        goal_type: 'steps',
        target_value: stepsTarget,
        actual_value: 0,
        completed: false,
      },
      {
        user_id: userId,
        date,
        goal_type: 'checkin',
        target_value: 1, // Binary: complete check-in
        actual_value: 0,
        completed: false,
      },
    ];

    // Only add weight goal for established users in weight loss challenges
    // For now, skip weight goal - can be added later based on FitCircle participation

    // Insert goals (upsert to handle duplicates)
    const { data, error } = await supabase
      .from('daily_goals')
      .upsert(goalsToCreate, {
        onConflict: 'user_id,date,goal_type',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      return { goals: [], error: new Error(error.message) };
    }

    return { goals: data || [], error: null };
  } catch (error) {
    return {
      goals: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get today's daily goals for a user
 */
export async function getTodayDailyGoals(
  userId: string,
  supabase: SupabaseClient
): Promise<{ goals: DailyGoal[]; error: Error | null }> {
  try {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('daily_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('date', today)
      .order('goal_type', { ascending: true });

    if (error) {
      return { goals: [], error: new Error(error.message) };
    }

    // If no goals exist, generate them
    if (!data || data.length === 0) {
      return await generateDailyGoals(userId, today, supabase);
    }

    return { goals: data, error: null };
  } catch (error) {
    return {
      goals: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get daily goal history for a user
 */
export async function getDailyGoalHistory(
  userId: string,
  days: number,
  supabase: SupabaseClient
): Promise<{ goals: DailyGoal[]; error: Error | null }> {
  try {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - days);

    const { data, error } = await supabase
      .from('daily_goals')
      .select('*')
      .eq('user_id', userId)
      .gte('date', daysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) {
      return { goals: [], error: new Error(error.message) };
    }

    return { goals: data || [], error: null };
  } catch (error) {
    return {
      goals: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Update daily goal progress
 */
export async function updateDailyGoalProgress(
  goalId: string,
  actualValue: number,
  userId: string,
  supabase: SupabaseClient
): Promise<{ goal: DailyGoal | null; error: Error | null }> {
  try {
    // Get the goal to check target
    const { data: goal, error: fetchError } = await supabase
      .from('daily_goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !goal) {
      return { goal: null, error: new Error('Goal not found') };
    }

    // Determine if goal is completed
    const completed = actualValue >= goal.target_value;

    // Update the goal
    const { data, error } = await supabase
      .from('daily_goals')
      .update({
        actual_value: actualValue,
        completed,
      })
      .eq('id', goalId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      return { goal: null, error: new Error(error.message) };
    }

    return { goal: data, error: null };
  } catch (error) {
    return {
      goal: null,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Sync daily goals with actual tracking data
 * Called after check-in to update goal progress
 */
export async function syncDailyGoalsWithTracking(
  userId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; error: Error | null }> {
  try {
    // Get tracking data for the date
    const { data: tracking, error: trackingError } = await supabase
      .from('daily_tracking')
      .select('steps, weight_kg')
      .eq('user_id', userId)
      .eq('tracking_date', date)
      .single();

    if (trackingError || !tracking) {
      return { success: false, error: new Error('Tracking data not found') };
    }

    // Get goals for the date
    const { data: goals, error: goalsError } = await supabase
      .from('daily_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date);

    if (goalsError) {
      return { success: false, error: new Error(goalsError.message) };
    }

    // Update each goal based on tracking data
    const updates = [];
    for (const goal of goals || []) {
      let actualValue = 0;
      let completed = false;

      switch (goal.goal_type) {
        case 'steps':
          actualValue = tracking.steps || 0;
          completed = actualValue >= goal.target_value;
          break;
        case 'checkin':
          actualValue = 1; // Check-in completed
          completed = true;
          break;
        case 'weight':
          // Weight goal completion logic (if needed)
          actualValue = tracking.weight_kg || 0;
          completed = actualValue > 0;
          break;
      }

      updates.push(
        supabase
          .from('daily_goals')
          .update({ actual_value: actualValue, completed })
          .eq('id', goal.id)
      );
    }

    await Promise.all(updates);

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

// ============================================================================
// WEEKLY GOAL GENERATION
// ============================================================================

/**
 * Get the start of the current week (Monday)
 */
export function getWeekStart(date: Date = new Date()): string {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0];
}

/**
 * Generate personalized weekly goals for a user
 */
export async function generateWeeklyGoals(
  userId: string,
  weekStart: string,
  fitcircleId: string | null,
  supabase: SupabaseClient
): Promise<{ goals: WeeklyGoal[]; error: Error | null }> {
  try {
    // Get user baseline
    const baseline = await calculateUserBaseline(userId, supabase);

    // Calculate weekly targets
    const weeklyStepsTarget = baseline.averageSteps * WEEKLY_STEPS_MULTIPLIER;

    // Goals to generate
    const goalsToCreate: Array<{
      user_id: string;
      week_start: string;
      goal_type: WeeklyGoalType;
      target_value: number;
      actual_value: number;
      daily_breakdown: Record<string, number>;
      completed: boolean;
      fitcircle_id: string | null;
    }> = [
      {
        user_id: userId,
        week_start: weekStart,
        goal_type: 'steps',
        target_value: weeklyStepsTarget,
        actual_value: 0,
        daily_breakdown: {},
        completed: false,
        fitcircle_id: fitcircleId,
      },
      {
        user_id: userId,
        week_start: weekStart,
        goal_type: 'streak',
        target_value: 7, // Complete all 7 days
        actual_value: 0,
        daily_breakdown: {},
        completed: false,
        fitcircle_id: fitcircleId,
      },
      {
        user_id: userId,
        week_start: weekStart,
        goal_type: 'active_days',
        target_value: 5, // At least 5 days with 3000+ steps
        actual_value: 0,
        daily_breakdown: {},
        completed: false,
        fitcircle_id: fitcircleId,
      },
    ];

    // Insert goals (upsert to handle duplicates)
    const { data, error } = await supabase
      .from('weekly_goals')
      .upsert(goalsToCreate, {
        onConflict: 'user_id,week_start,goal_type,fitcircle_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      return { goals: [], error: new Error(error.message) };
    }

    return { goals: data || [], error: null };
  } catch (error) {
    return {
      goals: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get current week's goals for a user
 */
export async function getCurrentWeeklyGoals(
  userId: string,
  fitcircleId: string | null,
  supabase: SupabaseClient
): Promise<{ goals: WeeklyGoal[]; error: Error | null }> {
  try {
    const weekStart = getWeekStart();

    let query = supabase
      .from('weekly_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart);

    if (fitcircleId) {
      query = query.eq('fitcircle_id', fitcircleId);
    } else {
      query = query.is('fitcircle_id', null);
    }

    const { data, error } = await query.order('goal_type', { ascending: true });

    if (error) {
      return { goals: [], error: new Error(error.message) };
    }

    // If no goals exist, generate them
    if (!data || data.length === 0) {
      return await generateWeeklyGoals(userId, weekStart, fitcircleId, supabase);
    }

    return { goals: data, error: null };
  } catch (error) {
    return {
      goals: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get weekly goal history
 */
export async function getWeeklyGoalHistory(
  userId: string,
  weeks: number,
  fitcircleId: string | null,
  supabase: SupabaseClient
): Promise<{ goals: WeeklyGoal[]; error: Error | null }> {
  try {
    const weeksAgo = new Date();
    weeksAgo.setDate(weeksAgo.getDate() - weeks * 7);
    const cutoffWeekStart = getWeekStart(weeksAgo);

    let query = supabase
      .from('weekly_goals')
      .select('*')
      .eq('user_id', userId)
      .gte('week_start', cutoffWeekStart);

    if (fitcircleId) {
      query = query.eq('fitcircle_id', fitcircleId);
    } else {
      query = query.is('fitcircle_id', null);
    }

    const { data, error } = await query.order('week_start', { ascending: false });

    if (error) {
      return { goals: [], error: new Error(error.message) };
    }

    return { goals: data || [], error: null };
  } catch (error) {
    return {
      goals: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Update weekly goal progress with daily data
 */
export async function updateWeeklyGoalProgress(
  userId: string,
  weekStart: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ success: boolean; error: Error | null }> {
  try {
    // Get tracking data for the date
    const { data: tracking, error: trackingError } = await supabase
      .from('daily_tracking')
      .select('steps')
      .eq('user_id', userId)
      .eq('tracking_date', date)
      .single();

    if (trackingError || !tracking) {
      return { success: false, error: new Error('Tracking data not found') };
    }

    // Get weekly goals
    const { data: goals, error: goalsError } = await supabase
      .from('weekly_goals')
      .select('*')
      .eq('user_id', userId)
      .eq('week_start', weekStart);

    if (goalsError) {
      return { success: false, error: new Error(goalsError.message) };
    }

    // Update each weekly goal
    const updates = [];
    for (const goal of goals || []) {
      const dailyBreakdown = goal.daily_breakdown || {};
      const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();

      dailyBreakdown[dayOfWeek] = tracking.steps || 0;

      // Calculate actual value based on goal type
      let actualValue = 0;
      let completed = false;

      switch (goal.goal_type) {
        case 'steps':
          actualValue = Object.values(dailyBreakdown).reduce((sum: number, val) => sum + (val as number || 0), 0);
          completed = actualValue >= goal.target_value;
          break;
        case 'streak':
          actualValue = Object.keys(dailyBreakdown).length;
          completed = actualValue >= goal.target_value;
          break;
        case 'active_days':
          actualValue = Object.values(dailyBreakdown).filter((steps) => (steps as number || 0) >= 3000).length;
          completed = actualValue >= goal.target_value;
          break;
      }

      updates.push(
        supabase
          .from('weekly_goals')
          .update({
            daily_breakdown: dailyBreakdown,
            actual_value: actualValue,
            completed,
            updated_at: new Date().toISOString(), // Explicitly set timestamp (no DB trigger)
          })
          .eq('id', goal.id)
      );
    }

    await Promise.all(updates);

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get team aggregated weekly performance for a FitCircle
 */
export async function getTeamWeeklyPerformance(
  fitcircleId: string,
  weekStart: string,
  supabase: SupabaseClient
): Promise<{
  totalSteps: number;
  averageCompletion: number;
  memberCount: number;
  error: Error | null;
}> {
  try {
    // Get all members of the FitCircle
    const { data: members, error: membersError } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', fitcircleId)
      .eq('is_active', true);

    if (membersError || !members) {
      return { totalSteps: 0, averageCompletion: 0, memberCount: 0, error: new Error('Failed to fetch members') };
    }

    const userIds = members.map(m => m.user_id);

    // Get weekly goals for all members
    const { data: goals, error: goalsError } = await supabase
      .from('weekly_goals')
      .select('*')
      .in('user_id', userIds)
      .eq('week_start', weekStart)
      .eq('fitcircle_id', fitcircleId)
      .eq('goal_type', 'steps');

    if (goalsError) {
      return { totalSteps: 0, averageCompletion: 0, memberCount: 0, error: new Error(goalsError.message) };
    }

    const totalSteps = (goals || []).reduce((sum, g) => sum + (g.actual_value || 0), 0);
    const completedCount = (goals || []).filter(g => g.completed).length;
    const averageCompletion = goals && goals.length > 0 ? (completedCount / goals.length) * 100 : 0;

    return {
      totalSteps,
      averageCompletion,
      memberCount: members.length,
      error: null,
    };
  } catch (error) {
    return {
      totalSteps: 0,
      averageCompletion: 0,
      memberCount: 0,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

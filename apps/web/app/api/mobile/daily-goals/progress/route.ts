import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { DailyGoalService } from '@/lib/services/daily-goals';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/daily-goals/progress
 * Get daily goal progress summary for a specific date
 *
 * Query params:
 * - date (optional): ISO date string (YYYY-MM-DD), defaults to today
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get date from query params
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const targetDate = dateParam || new Date().toISOString().split('T')[0];

    console.log(`[Mobile Daily Goals Progress] Fetching progress for user: ${user.id}, date: ${targetDate}`);

    // Fetch user's daily goals
    const { data: goals, error: goalsError } = await DailyGoalService.getUserDailyGoals(
      user.id,
      supabaseAdmin
    );

    if (goalsError) {
      console.error('[Mobile Daily Goals Progress] Error:', goalsError);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FETCH_ERROR',
            message: goalsError.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    // Get today's tracking data for actual values
    const { data: tracking } = await supabaseAdmin
      .from('daily_tracking')
      .select('*')
      .eq('user_id', user.id)
      .eq('tracking_date', targetDate)
      .maybeSingle();

    // Get completion history for the target date
    const { data: completions } = await supabaseAdmin
      .from('goal_completion_history')
      .select('daily_goal_id, completion_percentage, is_completed')
      .eq('user_id', user.id)
      .eq('completion_date', targetDate);

    const completionMap = new Map(
      (completions || []).map(c => [c.daily_goal_id, c])
    );

    // Build goals array with completion status
    // iOS expects { goal: DailyGoal, progress: GoalProgress?, completionPercentage, isCompleted }
    const goalsWithProgress = (goals || []).map(goal => {
      const completion = completionMap.get(goal.id);

      // Calculate real-time completion percentage from actual tracking data
      let completionPercentage = 0;
      let actualValue: number | null = null;

      if (tracking && goal.target_value) {
        switch (goal.goal_type) {
          case 'steps':
            actualValue = tracking.steps;
            if (actualValue !== null) {
              completionPercentage = Math.min((actualValue / goal.target_value) * 100, 100);
            }
            break;
          case 'weight_log':
            actualValue = tracking.weight_kg !== null ? 1 : 0;
            completionPercentage = actualValue === 1 ? 100 : 0;
            break;
          case 'mood':
            actualValue = tracking.mood_score;
            completionPercentage = actualValue !== null ? 100 : 0;
            break;
          case 'energy':
            actualValue = tracking.energy_level;
            completionPercentage = actualValue !== null ? 100 : 0;
            break;
        }
      }

      const isCompleted = completionPercentage >= 100;

      return {
        goal: goal, // iOS expects nested goal object
        progress: actualValue !== null ? {
          id: completion?.id || crypto.randomUUID(), // Generate UUID for iOS requirement
          daily_goal_id: goal.id,
          user_id: user.id,
          completion_date: targetDate,
          actual_value: actualValue,
          target_value: goal.target_value,
          completion_percentage: parseFloat(completionPercentage.toFixed(2)),
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
          logged_at: new Date().toISOString(),
        } : null,
        completion_percentage: parseFloat(completionPercentage.toFixed(2)),
        is_completed: isCompleted,
      };
    });

    // Calculate completion stats based on real-time data
    const completedCount = goalsWithProgress.filter(g => g.is_completed).length;
    const totalCount = goals?.length || 0;
    const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const summary = {
      date: targetDate,
      goals: goalsWithProgress,
      overallProgress: progressPercentage / 100, // iOS expects 0.0-1.0, not 0-100
      completedCount,
      totalCount,
      allCompleted: totalCount > 0 && completedCount === totalCount,
      streak: 0, // TODO: Calculate actual streak from goal_completion_history
    };

    console.log(`[Mobile Daily Goals Progress] Summary: ${completedCount}/${totalCount} goals complete (${progressPercentage}%)`);

    const response = NextResponse.json({
      success: true,
      data: summary,
      error: null,
      meta: {
        requestTime: Date.now(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Mobile Daily Goals Progress] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

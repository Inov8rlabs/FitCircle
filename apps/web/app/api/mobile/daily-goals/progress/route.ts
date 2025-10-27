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

    // Get completion history for the target date
    const { data: completions } = await supabaseAdmin
      .from('goal_completion_history')
      .select('daily_goal_id, completion_percentage, is_completed')
      .eq('user_id', user.id)
      .eq('completion_date', targetDate);

    const completionMap = new Map(
      (completions || []).map(c => [c.daily_goal_id, c])
    );

    // Calculate completion stats
    const completedCount = (completions || []).filter(c => c.is_completed).length;
    const totalCount = goals?.length || 0;
    const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    // Build goals array with completion status
    // iOS expects { goal: DailyGoal, progress: GoalProgress?, completionPercentage, isCompleted }
    const goalsWithProgress = (goals || []).map(goal => {
      const completion = completionMap.get(goal.id);
      return {
        goal: goal, // iOS expects nested goal object
        progress: null, // TODO: Add actual progress tracking data
        completion_percentage: completion?.completion_percentage || 0,
        is_completed: completion?.is_completed || false,
      };
    });

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

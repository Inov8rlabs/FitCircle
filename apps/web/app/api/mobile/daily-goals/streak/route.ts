import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/daily-goals/streak
 * Get daily goal completion streak information for the authenticated user
 *
 * This tracks streaks based on daily goal completions, not general engagement.
 * A day counts toward the streak if ALL daily goals were completed that day.
 *
 * Response:
 * {
 *   current_streak: number,
 *   longest_streak: number,
 *   last_completion_date: string | null,
 *   next_milestone: number,
 *   days_until_next_milestone: number
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    console.log(`[Mobile Daily Goals Streak] Calculating streak for user: ${user.id}`);

    // Get all dates where ALL goals were completed
    // We need to check goal_completion_history for days where all goals were marked complete
    const { data: completionHistory, error: historyError } = await supabaseAdmin
      .from('goal_completion_history')
      .select('completion_date, daily_goal_id, is_completed')
      .eq('user_id', user.id)
      .order('completion_date', { ascending: false });

    if (historyError) {
      console.error('[Mobile Daily Goals Streak] Error fetching completion history:', historyError);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FETCH_ERROR',
            message: historyError.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    // Get user's daily goals to know how many goals should be completed each day
    const { data: userGoals, error: goalsError } = await supabaseAdmin
      .from('daily_goals')
      .select('id, start_date, end_date')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (goalsError) {
      console.error('[Mobile Daily Goals Streak] Error fetching goals:', goalsError);
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

    // Group completions by date
    const completionsByDate = new Map<string, Set<string>>();
    (completionHistory || []).forEach(record => {
      if (record.is_completed) {
        if (!completionsByDate.has(record.completion_date)) {
          completionsByDate.set(record.completion_date, new Set());
        }
        completionsByDate.get(record.completion_date)!.add(record.daily_goal_id);
      }
    });

    // Helper function to check if all goals were completed on a given date
    const allGoalsCompletedOnDate = (dateStr: string): boolean => {
      const date = new Date(dateStr);

      // Find which goals should have been active on this date
      const activeGoalsOnDate = (userGoals || []).filter(goal => {
        const startDate = new Date(goal.start_date);
        const endDate = goal.end_date ? new Date(goal.end_date) : null;

        return date >= startDate && (!endDate || date <= endDate);
      });

      if (activeGoalsOnDate.length === 0) {
        // No goals active on this date, doesn't count toward streak
        return false;
      }

      const completedGoalsOnDate = completionsByDate.get(dateStr);
      if (!completedGoalsOnDate) {
        return false;
      }

      // Check if all active goals were completed
      return activeGoalsOnDate.every(goal => completedGoalsOnDate.has(goal.id));
    };

    // Calculate current and longest streaks
    const today = new Date().toISOString().split('T')[0];
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let lastCompletionDate: string | null = null;

    // Get all unique dates with completions, sorted descending
    const allDates = Array.from(completionsByDate.keys()).sort().reverse();

    if (allDates.length > 0) {
      // Calculate current streak (must be consecutive days up to today or yesterday)
      let checkDate = new Date(today);
      let checkingCurrent = true;

      // Check if today's goals are all complete
      if (allGoalsCompletedOnDate(today)) {
        currentStreak = 1;
        lastCompletionDate = today;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        // Check yesterday
        checkDate.setDate(checkDate.getDate() - 1);
        const yesterday = checkDate.toISOString().split('T')[0];
        if (allGoalsCompletedOnDate(yesterday)) {
          currentStreak = 1;
          lastCompletionDate = yesterday;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          checkingCurrent = false;
        }
      }

      // Continue checking backwards for current streak
      while (checkingCurrent && checkDate >= new Date(allDates[allDates.length - 1])) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (allGoalsCompletedOnDate(dateStr)) {
          currentStreak++;
          lastCompletionDate = dateStr;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          checkingCurrent = false;
        }
      }

      // Calculate longest streak
      longestStreak = currentStreak;
      tempStreak = 0;
      let prevDate: Date | null = null;

      // Check all dates for longest streak
      for (const dateStr of allDates.reverse()) {
        if (allGoalsCompletedOnDate(dateStr)) {
          const currentDate = new Date(dateStr);

          if (prevDate === null) {
            tempStreak = 1;
          } else {
            const diffDays = Math.floor((prevDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) {
              tempStreak++;
            } else {
              longestStreak = Math.max(longestStreak, tempStreak);
              tempStreak = 1;
            }
          }

          prevDate = currentDate;
        }
      }

      longestStreak = Math.max(longestStreak, tempStreak);
    }

    // Calculate milestones (7, 14, 30, 60, 90, 180, 365 days)
    const milestones = [7, 14, 30, 60, 90, 180, 365];
    const nextMilestone = milestones.find(m => m > currentStreak) || (Math.floor(currentStreak / 365) + 1) * 365;
    const daysUntilNextMilestone = nextMilestone - currentStreak;

    const streakInfo = {
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_completion_date: lastCompletionDate,
      next_milestone: nextMilestone,
      days_until_next_milestone: daysUntilNextMilestone,
    };

    console.log(`[Mobile Daily Goals Streak] Calculated: current=${currentStreak}, longest=${longestStreak}, next milestone=${nextMilestone}`);

    const response = NextResponse.json({
      success: true,
      data: streakInfo,
      error: null,
      meta: {
        requestTime: Date.now(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Mobile Daily Goals Streak] Error:', error);

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

/**
 * Daily Goals Progress API
 *
 * GET /api/daily-goals/progress - Get today's progress for all daily goals
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { DailyGoalService } from '@/lib/services/daily-goals';

/**
 * GET /api/daily-goals/progress
 * Get today's goal progress for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get today's progress
    const { data: progress, error } = await DailyGoalService.getTodayProgress(user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get streak info
    const { data: streak } = await DailyGoalService.calculateStreak(user.id, supabase);

    return NextResponse.json(
      {
        progress,
        streak: streak || { current_streak: 0, longest_streak: 0, last_completion_date: null },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching daily goals progress:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

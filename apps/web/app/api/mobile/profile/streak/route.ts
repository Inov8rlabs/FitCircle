import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/profile/streak
 * Calculate unified streak across daily tracking and circle check-ins
 *
 * Business Logic Decision:
 * A streak day counts if the user has EITHER:
 * - A daily_tracking entry for that date, OR
 * - At least one circle check-in for that date
 *
 * This unified approach encourages consistent engagement across all features.
 *
 * Response:
 * - personal_streak: number (unified streak across all tracking)
 * - circle_streaks: Array<{ circle_id, circle_name, streak_days }>
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get all daily tracking dates
    const { data: dailyTracking } = await supabaseAdmin
      .from('daily_tracking')
      .select('tracking_date')
      .eq('user_id', user.id)
      .order('tracking_date', { ascending: false })
      .limit(365); // Last year

    // Get all circle check-in dates
    const { data: circleCheckIns } = await supabaseAdmin
      .from('circle_check_ins')
      .select('check_in_date')
      .eq('user_id', user.id)
      .order('check_in_date', { ascending: false })
      .limit(365); // Last year

    // Combine dates into a Set (unique dates)
    const allDates = new Set<string>();

    (dailyTracking || []).forEach((entry) => {
      allDates.add(entry.tracking_date);
    });

    (circleCheckIns || []).forEach((entry) => {
      allDates.add(entry.check_in_date);
    });

    // Calculate unified streak
    let personalStreak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 365; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() - i);
      const targetDateStr = targetDate.toISOString().split('T')[0];

      if (allDates.has(targetDateStr)) {
        personalStreak++;
      } else if (i > 0) {
        // Streak broken (only break after first day, allow grace for today)
        break;
      }
    }

    // Get circle-specific streaks
    const { data: activeCircles } = await supabaseAdmin
      .from('challenge_participants')
      .select(`
        challenge_id,
        streak_days,
        challenges!challenge_participants_challenge_id_fkey (
          name
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('streak_days', { ascending: false });

    const circleStreaks = (activeCircles || []).map((circle: any) => ({
      circle_id: circle.challenge_id,
      circle_name: circle.challenges?.name || 'Unknown Circle',
      streak_days: circle.streak_days || 0,
    }));

    const response = NextResponse.json({
      success: true,
      data: {
        personal_streak: personalStreak,
        circle_streaks: circleStreaks,
        total_active_circles: circleStreaks.length,
      },
      error: null,
      meta: {
        calculation_method: 'unified',
        description: 'Streak counts days with either daily tracking or circle check-ins',
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Get streak error:', error);

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

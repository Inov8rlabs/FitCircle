import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/profile/stats
 * Get all-time user statistics
 *
 * Response:
 * - total_circles: number (all circles user has joined)
 * - total_check_ins: number (across all circles and daily tracking)
 * - best_streak: number (longest streak ever)
 * - high_fives_sent: number
 * - high_fives_received: number
 * - circles_completed: number
 * - circles_won: number (if we track winners)
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get total circles (all memberships, including left ones)
    const { count: totalCircles } = await supabaseAdmin
      .from('challenge_participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get total check-ins from circle_check_ins
    const { count: circleCheckIns } = await supabaseAdmin
      .from('circle_check_ins')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get total check-ins from daily_tracking
    const { count: dailyCheckIns } = await supabaseAdmin
      .from('daily_tracking')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    // Get best streak from challenge_participants
    const { data: participants } = await supabaseAdmin
      .from('challenge_participants')
      .select('longest_streak')
      .eq('user_id', user.id)
      .order('longest_streak', { ascending: false })
      .limit(1);

    const bestStreak = participants && participants.length > 0
      ? participants[0].longest_streak
      : 0;

    // Get high-fives sent (count encouragements of type 'high_five')
    const { count: highFivesSent } = await supabaseAdmin
      .from('circle_encouragements')
      .select('id', { count: 'exact', head: true })
      .eq('from_user_id', user.id)
      .eq('type', 'high_five');

    // Get high-fives received
    const { count: highFivesReceived } = await supabaseAdmin
      .from('circle_encouragements')
      .select('id', { count: 'exact', head: true })
      .eq('to_user_id', user.id)
      .eq('type', 'high_five');

    // Get completed circles (status = 'completed' from participants where circle has ended)
    const { count: circlesCompleted } = await supabaseAdmin
      .from('challenge_participants')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'completed');

    // Get profile stats
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('challenges_won, current_streak, total_points')
      .eq('id', user.id)
      .single();

    let response = NextResponse.json({
      success: true,
      data: {
        total_circles: totalCircles || 0,
        total_check_ins: (circleCheckIns || 0) + (dailyCheckIns || 0),
        circle_check_ins: circleCheckIns || 0,
        daily_check_ins: dailyCheckIns || 0,
        best_streak: bestStreak || 0,
        current_streak: profile?.current_streak || 0,
        high_fives_sent: highFivesSent || 0,
        high_fives_received: highFivesReceived || 0,
        circles_completed: circlesCompleted || 0,
        circles_won: profile?.challenges_won || 0,
        total_points: profile?.total_points || 0,
      },
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Get profile stats error:', error);

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

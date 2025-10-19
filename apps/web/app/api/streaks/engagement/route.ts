import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * GET /api/streaks/engagement
 *
 * Get engagement streak for the authenticated user (web cookie-based auth)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Query streak data
    const { data: streak, error: streakError } = await supabase
      .from('engagement_streaks')
      .select('current_streak, longest_streak, streak_freezes_available, paused, pause_end_date, last_engagement_date')
      .eq('user_id', user.id)
      .maybeSingle();

    if (streakError) {
      console.error('[GET /api/streaks/engagement] Database error:', streakError);
      return NextResponse.json(
        { error: 'Failed to fetch streak data' },
        { status: 500 }
      );
    }

    // If no streak record exists, return default values
    if (!streak) {
      return NextResponse.json({
        current_streak: 0,
        longest_streak: 0,
        streak_freezes_available: 1,
        paused: false,
        pause_end_date: null,
        last_engagement_date: null,
      });
    }

    return NextResponse.json(streak);

  } catch (error) {
    console.error('[GET /api/streaks/engagement] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

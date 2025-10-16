import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { MAX_PAUSE_DURATION_DAYS } from '@/lib/types/streak';

/**
 * POST /api/streaks/engagement/pause
 * Pause engagement streak for up to 90 days
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { resume_date, reason } = body;

    console.log('[POST /api/streaks/engagement/pause] User:', user.id, 'Resume date:', resume_date);

    // Validate resume_date if provided
    if (resume_date) {
      const resumeDate = new Date(resume_date);
      const now = new Date();
      const diffDays = Math.floor((resumeDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      if (diffDays < 0) {
        return NextResponse.json(
          { error: 'Resume date must be in the future' },
          { status: 400 }
        );
      }

      if (diffDays > MAX_PAUSE_DURATION_DAYS) {
        return NextResponse.json(
          { error: `Resume date cannot be more than ${MAX_PAUSE_DURATION_DAYS} days in the future` },
          { status: 400 }
        );
      }
    }

    // Pause streak
    await EngagementStreakService.pauseStreak(user.id, resume_date);

    return NextResponse.json({ success: true, message: 'Streak paused successfully' });

  } catch (error) {
    console.error('[POST /api/streaks/engagement/pause] Error:', error);

    // Handle specific error types
    if (error instanceof Error && error.message.includes('already paused')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to pause streak', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * POST /api/streaks/engagement/resume
 * Resume paused engagement streak
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[POST /api/streaks/engagement/resume] User:', user.id);

    // Resume streak
    await EngagementStreakService.resumeStreak(user.id);

    return NextResponse.json({ success: true, message: 'Streak resumed successfully' });

  } catch (error) {
    console.error('[POST /api/streaks/engagement/resume] Error:', error);

    // Handle specific error types
    if (error instanceof Error && error.message.includes('not currently paused')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to resume streak', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

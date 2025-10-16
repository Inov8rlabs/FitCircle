import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * GET /api/streaks/engagement
 * Get user's engagement streak details
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[GET /api/streaks/engagement] Fetching streak for user:', user.id);

    // Get engagement streak
    const streak = await EngagementStreakService.getEngagementStreak(user.id);

    return NextResponse.json({ success: true, data: streak });

  } catch (error) {
    console.error('[GET /api/streaks/engagement] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch engagement streak', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

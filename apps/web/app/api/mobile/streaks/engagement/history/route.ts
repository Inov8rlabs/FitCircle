import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * GET /api/streaks/engagement/history
 * Get last 90 days of engagement activity
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get days parameter from query string (default 90)
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '90', 10);

    // Validate days parameter
    if (days < 1 || days > 365) {
      return NextResponse.json(
        { error: 'Days parameter must be between 1 and 365' },
        { status: 400 }
      );
    }

    console.log(`[GET /api/streaks/engagement/history] Fetching ${days} days for user:`, user.id);

    // Get engagement history
    const history = await EngagementStreakService.getEngagementHistory(user.id, days);

    return NextResponse.json({ success: true, data: history });

  } catch (error) {
    console.error('[GET /api/streaks/engagement/history] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch engagement history', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

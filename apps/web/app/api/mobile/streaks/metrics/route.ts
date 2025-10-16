import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { MetricStreakService } from '@/lib/services/metric-streak-service';

/**
 * GET /api/streaks/metrics
 * Get all metric streaks for user (weight, steps, mood, measurements, photos)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[GET /api/streaks/metrics] Fetching all metric streaks for user:', user.id);

    // Get all metric streaks
    const streaks = await MetricStreakService.getMetricStreaks(user.id);

    return NextResponse.json({ success: true, data: streaks });

  } catch (error) {
    console.error('[GET /api/streaks/metrics] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metric streaks', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

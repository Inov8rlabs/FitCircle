/**
 * API Route: /api/cron/leaderboard-refresh
 *
 * Refresh leaderboards for all FitCircles (run every 5 min during peak hours)
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret, createAdminSupabase } from '@/lib/utils/api-auth';
import { recalculateLeaderboard } from '@/lib/services/leaderboard-service-v2';

/**
 * GET /api/cron/leaderboard-refresh
 * Query params:
 * - period: 'daily' | 'weekly' | 'monthly' (default: 'daily')
 *
 * Refresh leaderboards for all active FitCircles
 * Requires: CRON_SECRET in authorization header
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') || 'daily') as 'daily' | 'weekly' | 'monthly';

    const supabase = createAdminSupabase();

    // Get all active FitCircles (circles with active members)
    const { data: activeCircles, error: circlesError } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('is_active', true);

    if (circlesError) {
      return NextResponse.json(
        { error: 'Failed to fetch active circles', details: circlesError.message },
        { status: 500 }
      );
    }

    // Get unique circle IDs
    const uniqueCircleIds = [...new Set((activeCircles || []).map(m => m.circle_id))];

    // Recalculate leaderboard for each circle
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const circleId of uniqueCircleIds) {
      // Determine metric type (default to steps, can be enhanced to check challenge type)
      const metricType = 'steps';

      const { entries, error } = await recalculateLeaderboard(circleId, period, metricType, supabase);

      if (error) {
        errorCount++;
        errors.push(`Circle ${circleId}: ${error.message}`);
      } else {
        successCount++;
      }
    }

    return NextResponse.json({
      success: true,
      period,
      total_circles: uniqueCircleIds.length,
      success_count: successCount,
      error_count: errorCount,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error('Leaderboard refresh cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * API Route: /api/fitcircles/[id]/leaderboard-v2
 *
 * Get FitCircle leaderboard with period support (Phase 1 Engagement)
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getLeaderboard, recalculateLeaderboard, type LeaderboardPeriod, type MetricType } from '@/lib/services/leaderboard-service-v2';

/**
 * GET /api/fitcircles/[id]/leaderboard-v2
 * Query params:
 * - period: 'daily' | 'weekly' | 'monthly' | 'all_time' (default: 'weekly')
 *
 * Fetch leaderboard for a FitCircle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fitcircleId } = await params;
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') || 'weekly') as LeaderboardPeriod;

    // Validate period
    if (!['daily', 'weekly', 'monthly', 'all_time'].includes(period)) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
    }

    const supabase = createAdminSupabase();

    // Verify user is a member of the FitCircle
    const { data: membership, error: memberError } = await supabase
      .from('circle_members')
      .select('id')
      .eq('circle_id', fitcircleId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();

    if (memberError || !membership) {
      return NextResponse.json({ error: 'Not a member of this FitCircle' }, { status: 403 });
    }

    // Get leaderboard
    const { entries, error } = await getLeaderboard(fitcircleId, period, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      fitcircle_id: fitcircleId,
      period,
      entries,
    });
  } catch (error) {
    console.error('Get leaderboard error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/fitcircles/[id]/leaderboard-v2
 * Query params:
 * - period: 'daily' | 'weekly' | 'monthly' | 'all_time' (default: 'daily')
 * - metric: 'steps' | 'weight_loss_pct' | 'checkin_streak' (default: 'steps')
 *
 * Force recalculate leaderboard (cron only - requires CRON_SECRET)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify this is a cron request
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fitcircleId } = await params;
    const { searchParams } = new URL(request.url);
    const period = (searchParams.get('period') || 'daily') as LeaderboardPeriod;
    const metric = (searchParams.get('metric') || 'steps') as MetricType;

    const supabase = createAdminSupabase();

    const { entries, error } = await recalculateLeaderboard(fitcircleId, period, metric, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      fitcircle_id: fitcircleId,
      period,
      metric,
      entries_updated: entries.length,
    });
  } catch (error) {
    console.error('Recalculate leaderboard error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

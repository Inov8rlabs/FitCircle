/**
 * API Route: /api/fitcircles/[id]/leaderboard/user/[userId]
 *
 * Get user's rank across all periods
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getUserRankings } from '@/lib/services/leaderboard-service-v2';

/**
 * GET /api/fitcircles/[id]/leaderboard/user/[userId]
 *
 * Get user's rankings across all periods in a FitCircle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fitcircleId, userId: targetUserId } = await params;

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

    // Get rankings
    const { daily, weekly, monthly, all_time, error } = await getUserRankings(
      targetUserId,
      fitcircleId,
      supabase
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      fitcircle_id: fitcircleId,
      user_id: targetUserId,
      rankings: {
        daily,
        weekly,
        monthly,
        all_time,
      },
    });
  } catch (error) {
    console.error('Get user rankings error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

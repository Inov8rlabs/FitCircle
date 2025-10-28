/**
 * API Route: /api/streaks/current
 *
 * Get current user streak
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getUserStreak, isFreezeAvailable, getNextMilestone } from '@/lib/services/streak-service-v2';

/**
 * GET /api/streaks/current
 *
 * Fetch user's current streak information
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();

    const { streak, error } = await getUserStreak(user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!streak) {
      return NextResponse.json({ error: 'Streak not found' }, { status: 404 });
    }

    const freezeAvailable = isFreezeAvailable(streak);
    const nextMilestone = getNextMilestone(streak.current_streak);

    return NextResponse.json({
      streak,
      freeze_available: freezeAvailable,
      next_milestone: nextMilestone,
    });
  } catch (error) {
    console.error('Get current streak error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * API Route: /api/streaks/current
 *
 * Get current user streak
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { getUserStreak, getShieldAvailability, getNextMilestone } from '@/lib/services/streak-service-v2';
import { createAdminSupabase } from '@/lib/utils/api-auth';

/**
 * GET /api/streaks/current
 *
 * Fetch user's current streak information
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const supabase = createAdminSupabase();

    // Honour the device's local timezone so date math doesn't drift to UTC.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    const { streak, error } = await getUserStreak(user.id, supabase, timezone);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!streak) {
      return NextResponse.json({ error: 'Streak not found' }, { status: 404 });
    }

    const shields = await getShieldAvailability(user.id);
    const nextMilestone = getNextMilestone(streak.current_streak);

    return NextResponse.json({
      streak,
      freeze_available: shields.unlimited || shields.available > 0,
      shields_available: shields.available,
      shields_unlimited: shields.unlimited,
      next_milestone: nextMilestone,
    });
  } catch (error: any) {
    console.error('Get current streak error:', error);
    // Expired/invalid token → 401 so the client refreshes and retries (not a 500).
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

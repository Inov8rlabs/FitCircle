/**
 * API Route: /api/streaks/checkin
 *
 * Complete check-in and increment streak
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { completeCheckin } from '@/lib/services/streak-service-v2';

/**
 * POST /api/streaks/checkin
 * Body: { date?: string }
 *
 * Complete check-in and increment streak (defaults to today)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const date = body.date || new Date().toISOString().split('T')[0];

    const supabase = createAdminSupabase();

    const { streak, milestoneReached, freezeUsed, error } = await completeCheckin(user.id, date, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      streak,
      milestone_reached: milestoneReached,
      freeze_used: freezeUsed,
      success: true,
    });
  } catch (error) {
    console.error('Complete check-in error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

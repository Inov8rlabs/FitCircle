/**
 * API Route: /api/streaks/milestones
 *
 * Get earned milestone badges
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getEarnedMilestones } from '@/lib/services/streak-service-v2';

/**
 * GET /api/streaks/milestones
 *
 * Fetch user's earned milestone badges
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();

    const { milestones, error } = await getEarnedMilestones(user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ milestones });
  } catch (error) {
    console.error('Get milestones error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

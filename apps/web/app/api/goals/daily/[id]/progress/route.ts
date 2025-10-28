/**
 * API Route: /api/goals/daily/[id]/progress
 *
 * Update daily goal progress
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { updateDailyGoalProgress } from '@/lib/services/goal-service';

/**
 * PUT /api/goals/daily/[id]/progress
 * Body: { actual_value: number }
 *
 * Update goal progress
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: goalId } = await params;
    const body = await request.json();
    const { actual_value } = body;

    if (actual_value === undefined || actual_value === null) {
      return NextResponse.json({ error: 'actual_value is required' }, { status: 400 });
    }

    if (typeof actual_value !== 'number' || actual_value < 0) {
      return NextResponse.json({ error: 'actual_value must be a positive number' }, { status: 400 });
    }

    const supabase = createAdminSupabase();

    const { goal, error } = await updateDailyGoalProgress(goalId, actual_value, user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!goal) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    }

    return NextResponse.json({ goal, updated: true });
  } catch (error) {
    console.error('Update daily goal progress error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

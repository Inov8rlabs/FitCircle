import { type NextRequest, NextResponse } from 'next/server';

import { groupMealErrorResponse } from '@/lib/http/group-meal-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { GroupMealService } from '@/lib/services/group-meal-service';

/**
 * GET /api/mobile/group-meals/[id]
 * PRD §6.12 — active-member-gated read of a group meal with all its tag statuses.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    const meal = await GroupMealService.getGroupMeal(id, user.id);

    return NextResponse.json({
      success: true,
      data: meal,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return groupMealErrorResponse(error, startTime);
  }
}

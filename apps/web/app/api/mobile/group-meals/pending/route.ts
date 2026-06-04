import { type NextRequest, NextResponse } from 'next/server';

import { groupMealErrorResponse } from '@/lib/http/group-meal-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { GroupMealService } from '@/lib/services/group-meal-service';

/**
 * GET /api/mobile/group-meals/pending
 * PRD §6.12 — the viewer's "accept into diary" inbox: group meals they're tagged in,
 * pending acceptance. Thin route: logic lives in GroupMealService.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const pending = await GroupMealService.getPendingTags(user.id);

    return NextResponse.json({
      success: true,
      data: pending,
      meta: { requestTime: Date.now() - startTime, count: pending.length },
      error: null,
    });
  } catch (error: any) {
    return groupMealErrorResponse(error, startTime);
  }
}

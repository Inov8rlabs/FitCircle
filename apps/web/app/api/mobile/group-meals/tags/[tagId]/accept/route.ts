import { type NextRequest, NextResponse } from 'next/server';

import { groupMealErrorResponse } from '@/lib/http/group-meal-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { GroupMealService } from '@/lib/services/group-meal-service';

/**
 * POST /api/mobile/group-meals/tags/[tagId]/accept
 * PRD §6.12 — accept a tagged group meal into your own diary (creates a food_log_entry).
 * Idempotent: re-accepting returns the existing accepted tag without a duplicate entry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { tagId } = await params;

    const tag = await GroupMealService.acceptTag(tagId, user.id);

    return NextResponse.json({
      success: true,
      data: tag,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return groupMealErrorResponse(error, startTime);
  }
}

import { type NextRequest, NextResponse } from 'next/server';

import { groupMealErrorResponse } from '@/lib/http/group-meal-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { GroupMealService } from '@/lib/services/group-meal-service';

/**
 * POST /api/mobile/group-meals/tags/[tagId]/decline
 * PRD §6.12 — decline a tagged group meal (no diary entry created).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tagId: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { tagId } = await params;

    const tag = await GroupMealService.declineTag(tagId, user.id);

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

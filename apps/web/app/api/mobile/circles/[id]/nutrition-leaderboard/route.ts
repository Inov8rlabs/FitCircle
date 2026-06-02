import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleFoodFeedService } from '@/lib/services/circle-food-feed-service';

/**
 * GET /api/mobile/circles/[id]/nutrition-leaderboard
 * PRD v4 §6.3 — ADDITIVE nutrition leaderboard metrics (adherence %, calorie-goal hit
 * rate, nutrition log streak). §6.7: consistency / showing-up signals only — never
 * "fewest calories" / "fastest loss". Layers onto the existing leaderboard.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    const result = await CircleFoodFeedService.nutritionLeaderboard(id, user.id);

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime, count: result.rows.length },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    if (error?.message === 'Forbidden') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'FORBIDDEN', message: 'You are not a member of this circle', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 403 }
      );
    }
    if (error?.message === 'NotFound') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Circle not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 404 }
      );
    }
    console.error('[Mobile API] nutrition-leaderboard error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}

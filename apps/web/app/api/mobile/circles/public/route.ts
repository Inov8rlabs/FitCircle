import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleService } from '@/lib/services/circle-service';

/**
 * GET /api/mobile/circles/public?limit=50
 * Discover public FitCircles the authenticated user can join.
 *
 * Returns circles where:
 *   - visibility = 'public'
 *   - status IN ('upcoming', 'active')
 *   - the user is not the creator
 *   - the user is not already a member
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;

    const circles = await CircleService.getJoinablePublicCircles(user.id, limit);

    return NextResponse.json({
      success: true,
      data: circles,
      error: null,
      meta: { requestTime: Date.now() - startTime },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/circles/public] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

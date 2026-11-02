import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleStepsLeaderboardService } from '@/lib/services/circle-steps-leaderboard-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';
import { isUuid, normalizeId } from '@/lib/validation/circle-validation';

/**
 * GET /api/mobile/circles/[id]/steps-leaderboard
 * Steps board for a circle: today's steps, total steps since the start, and % of
 * the daily step goal — each ranked server-side. Active members (or the creator)
 * only. "Today" is the device's day (X-Client-Timezone).
 * Contract: docs/CIRCLE_STEPS_LEADERBOARD.md
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id: rawId } = await params;
    if (!isUuid(rawId)) return fail('INVALID_CIRCLE_ID', 'Invalid circle ID format', 400);

    const result = await CircleStepsLeaderboardService.build(
      normalizeId(rawId),
      user.id,
      resolveClientTimezone(request)
    );
    if (!result.ok) {
      return result.code === 'CIRCLE_NOT_FOUND'
        ? fail('CIRCLE_NOT_FOUND', 'Circle not found', 404)
        : fail('FORBIDDEN', 'You must be a member of this circle to view the leaderboard', 403);
    }

    return NextResponse.json(
      { success: true, data: result.board, error: null, meta: { requestTime: Date.now() - startTime } },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return fail('UNAUTHORIZED', 'Invalid or expired token', 401);
    console.error('[StepsLeaderboard] Error:', error?.message ?? error);
    return fail('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details: {}, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

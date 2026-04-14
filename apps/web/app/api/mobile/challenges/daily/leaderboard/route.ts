import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

/**
 * GET /api/mobile/challenges/daily/leaderboard?challenge_id=xxx&limit=20
 * Get today's daily challenge leaderboard
 */
export async function GET(request: NextRequest) {
  try {
    await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);

    const challengeId = searchParams.get('challenge_id');
    if (!challengeId) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'challenge_id is required' } },
        { status: 400 }
      );
    }

    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    const leaderboard = await DailyChallengeService.getLeaderboard(challengeId, limit);

    const response = NextResponse.json({
      success: true,
      data: leaderboard,
      error: null,
    });

    response.headers.set('Cache-Control', 'private, max-age=15');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/challenges/daily/leaderboard] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

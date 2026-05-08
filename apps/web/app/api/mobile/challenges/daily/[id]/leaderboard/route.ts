import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

const idSchema = z.string().uuid();

/**
 * GET /api/mobile/challenges/daily/[id]/leaderboard?limit=20
 * Top participants for a daily challenge, ordered by progress desc.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireMobileAuth(request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);

    const { searchParams } = new URL(request.url);
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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid challenge id', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('[GET /api/mobile/challenges/daily/[id]/leaderboard] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

/**
 * GET /api/mobile/challenges/daily
 * Get today's daily challenge with user's progress
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const challenge = await DailyChallengeService.getCurrentChallenge(user.id);

    const response = NextResponse.json({
      success: true,
      data: challenge,
      error: null,
    });

    response.headers.set('Cache-Control', 'private, max-age=30');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/challenges/daily] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

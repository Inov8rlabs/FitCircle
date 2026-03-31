import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeService } from '@/lib/services/circle-challenge-service';

/**
 * GET /api/fitcircles/[id]/challenges/[challengeId]/leaderboard
 * Get the challenge leaderboard
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { challengeId } = await params;

    const leaderboard = await ChallengeService.getLeaderboard(challengeId, user.id);

    return NextResponse.json({
      success: true,
      data: leaderboard,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}

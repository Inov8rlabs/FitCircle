import { type NextRequest, NextResponse } from 'next/server';

import { unhandledChallengeError } from '@/lib/http/circle-challenge-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeService } from '@/lib/services/circle-challenge-service';

/**
 * GET /api/fitcircles/[id]/challenges/[challengeId]
 * Get challenge detail
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { challengeId } = await params;

    const challenge = await ChallengeService.getChallenge(challengeId, user.id);

    return NextResponse.json({
      success: true,
      data: challenge,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return unhandledChallengeError(error, 'fitcircles/[id]/challenges/[challengeId] GET');
  }
}

/**
 * PATCH /api/fitcircles/[id]/challenges/[challengeId]
 * Update a challenge (creator only, pre-start)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { challengeId } = await params;
    const body = await request.json();

    const challenge = await ChallengeService.updateChallenge(challengeId, user.id, body);

    return NextResponse.json({
      success: true,
      data: challenge,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return unhandledChallengeError(error, 'fitcircles/[id]/challenges/[challengeId] PATCH');
  }
}

/**
 * DELETE /api/fitcircles/[id]/challenges/[challengeId]
 * Cancel a challenge (creator only, pre-completion)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { challengeId } = await params;

    await ChallengeService.cancelChallenge(challengeId, user.id);

    return NextResponse.json({
      success: true,
      data: null,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return unhandledChallengeError(error, 'fitcircles/[id]/challenges/[challengeId] DELETE');
  }
}

import { type NextRequest, NextResponse } from 'next/server';

import { challengeErrorResponse, normalizeId } from '@/lib/http/circle-challenge-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeService } from '@/lib/services/circle-challenge-service';

/**
 * DELETE /api/fitcircles/[id]/challenges/[challengeId]/logs/[logId]
 * Delete one of the caller's own logs from today (UTC). The caller's totals,
 * completion percentage, streak and everyone's rank are re-derived.
 *
 * Errors: 400 LOG_LOCKED (not from today) / CHALLENGE_ENDED, 403 FORBIDDEN
 * (someone else's log, or not a circle member), 404 NOT_FOUND.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string; logId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id, challengeId, logId } = await params;

    await ChallengeService.deleteLog(normalizeId(logId), user.id, {
      circleId: normalizeId(id),
      challengeId: normalizeId(challengeId),
    });

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (error: unknown) {
    return challengeErrorResponse(error, 'Delete activity log');
  }
}

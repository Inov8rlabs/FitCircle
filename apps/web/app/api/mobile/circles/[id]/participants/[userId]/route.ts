import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleService, type RemoveParticipantFailure } from '@/lib/services/circle-service';
import { isUuid } from '@/lib/validation/circle-validation';

const FAILURES: Record<RemoveParticipantFailure, { status: number; code: string; message: string }> = {
  CIRCLE_NOT_FOUND: { status: 404, code: 'NOT_FOUND', message: 'Circle not found' },
  NOT_CREATOR: {
    status: 403,
    code: 'FORBIDDEN',
    message: 'Only the circle creator can remove participants',
  },
  CANNOT_REMOVE_CREATOR: {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'The circle creator cannot be removed',
  },
  CANNOT_REMOVE_SELF: {
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'You cannot remove yourself. Leave the circle instead.',
  },
  NOT_A_MEMBER: {
    status: 404,
    code: 'NOT_FOUND',
    message: 'This user is not a member of the circle',
  },
};

function failure(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details: {}, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status }
  );
}

/**
 * DELETE /api/mobile/circles/[id]/participants/[userId]
 * Remove a member from a circle (bearer auth).
 *
 * `userId` is the member's USER id (iOS passes LeaderboardEntry.userId).
 *
 * Permissions: only the circle creator. The creator can never be removed, so
 * nobody can remove themselves through this route (members use /leave).
 * The target must be a member of the circle.
 *
 * Response: { success: true, data: { message, removed_user_id, circle_id } }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId, userId: targetUserId } = await params;

    if (!isUuid(circleId) || !isUuid(targetUserId)) {
      return failure(400, 'VALIDATION_ERROR', 'Invalid circle or user id');
    }

    const result = await CircleService.removeParticipant(user.id, circleId, targetUserId, {
      requireMembership: true,
    });

    if (!result.ok) {
      const mapped = FAILURES[result.reason];
      return failure(mapped.status, mapped.code, mapped.message);
    }

    const response = NextResponse.json({
      success: true,
      data: {
        message: 'Participant removed successfully',
        removed_user_id: result.userId,
        circle_id: result.circleId,
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return failure(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }

    console.error('[DELETE /api/mobile/circles/[id]/participants/[userId]] Error:', error?.message);
    return failure(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}

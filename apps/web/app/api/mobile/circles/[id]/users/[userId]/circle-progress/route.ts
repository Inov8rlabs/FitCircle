import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleNotFoundError, MemberProgressService } from '@/lib/services/member-progress-service';
import { normalizeId } from '@/lib/validation/circle-validation';

const errorBody = (code: string, message: string) => ({
  success: false,
  data: null,
  error: { code, message, details: {}, timestamp: new Date().toISOString() },
  meta: null,
});

/**
 * GET /api/mobile/circles/[id]/users/[userId]/circle-progress
 *
 * The member's progress in the metric this circle tracks (steps, weight,
 * workout minutes, a custom challenge unit), with explicit `metric` / `unit`,
 * date-only entries in the member's local days and privacy applied.
 * Contract: docs/MEMBER_PROGRESS_CONTRACT.md. Hidden progress is 200 with
 * `can_view: false` and a `hidden_reason`, never an error.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: rawCircleId, userId: rawUserId } = await params;
    // iOS sends uppercase uuids in the path; owner / membership checks compare strings.
    const circleId = normalizeId(rawCircleId);
    const userId = normalizeId(rawUserId);

    const progress = await MemberProgressService.getMemberCircleProgress(userId, user.id, circleId);

    const response = NextResponse.json(
      { success: true, data: progress, error: null, meta: { requestTime: Date.now() } },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(errorBody('UNAUTHORIZED', 'Invalid or expired token'), { status: 401 });
    }
    if (error instanceof CircleNotFoundError || error?.message === 'User not found') {
      return NextResponse.json(errorBody('NOT_FOUND', error.message), { status: 404 });
    }
    console.error('[Circle Member Progress] Error:', error);
    return NextResponse.json(errorBody('INTERNAL_SERVER_ERROR', 'An unexpected error occurred'), { status: 500 });
  }
}

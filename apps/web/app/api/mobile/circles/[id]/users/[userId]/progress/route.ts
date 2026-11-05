import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleNotFoundError, MemberProgressService } from '@/lib/services/member-progress-service';
import { UserService } from '@/lib/services/user-service';
import { normalizeId } from '@/lib/validation/circle-validation';

/** What a viewer gets when the owner keeps their weight private. */
const PRIVATE_PROGRESS = {
  starting_weight: null,
  current_weight: null,
  target_weight: null,
  progress_percentage: 0,
  weight_lost: 0,
  weight_to_go: 0,
  last_updated: null,
};

/** The errors that used to be answered with 403 FORBIDDEN. */
function isPrivacyDenial(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.includes('private') || message.includes('Weight data');
}

/**
 * GET /api/mobile/circles/[id]/users/[userId]/progress
 * Get user weight progress within circle context
 *
 * Privacy: when the owner hides their weight the answer is 200 with
 * `can_view: false` and empty values (it used to be 403). Both apps render their
 * "Weight data is private" card from `can_view == false`; iOS 1.0 swallowed the
 * 403 and rendered nothing at all.
 *
 * This is the WEIGHT card. A circle that tracks something else (steps, workout
 * minutes, a custom challenge) answers `success: true, data: null`: shipped iOS
 * and Android then render no weight card (iOS throws on a nil `data` and
 * swallows it; Android treats it as unavailable). They used to show an empty
 * "Weight progress" card on a steps circle. New clients read `/circle-progress`.
 * `metric` / `unit` are additive.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: rawCircleId, userId: rawUserId } = await params;
    // iOS sends uppercase uuids in the path; the owner check compares strings.
    const userId = normalizeId(rawUserId);
    const circleId = normalizeId(rawCircleId);

    console.log(`[Circle User Progress] User ${user.id} viewing progress ${userId} in circle ${circleId}`);

    const described = await MemberProgressService.describe(userId, user.id, circleId);
    if (described.metric !== 'weight') {
      const response = NextResponse.json(
        {
          success: true,
          data: null,
          error: null,
          meta: { requestTime: Date.now(), metric: described.metric, unit: described.unit },
        },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
      return await addAutoRefreshHeaders(request, response, user);
    }

    // Weight circle. Hidden (show_weight / show_progress off, private profile,
    // viewer not in the circle) → can_view false with empty values.
    let canView = described.can_view;
    let progress;
    if (canView) {
      try {
        progress = await UserService.getUserProgress(userId, user.id, circleId);
      } catch (progressError) {
        if (!isPrivacyDenial(progressError)) throw progressError;
        canView = false;
        progress = PRIVATE_PROGRESS;
      }
    } else {
      progress = PRIVATE_PROGRESS;
    }

    const response = NextResponse.json(
      {
        success: true,
        data: {
          ...progress,
          weight_unit: 'kg',
          can_view: canView,
          metric: 'weight',
          unit: 'kg',
        },
        error: null,
        meta: {
          requestTime: Date.now(),
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store', // 2 minutes
        },
      }
    );

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Circle User Progress] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error instanceof CircleNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: error.message, details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

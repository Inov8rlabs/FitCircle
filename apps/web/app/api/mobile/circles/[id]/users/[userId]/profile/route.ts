import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { MemberProgressService } from '@/lib/services/member-progress-service';
import { UserService } from '@/lib/services/user-service';
import { normalizeId } from '@/lib/validation/circle-validation';

/**
 * GET /api/mobile/circles/[id]/users/[userId]/profile
 * Get user profile within circle context
 *
 * The weight fields are only filled in a weight circle the viewer may see the
 * weight of; `progress_percentage` follows the circle's metric (a steps
 * circle's goal %, not a weight %). Shipped apps show it as the "% Complete"
 * badge.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: rawCircleId, userId: rawUserId } = await params;
    const circleId = normalizeId(rawCircleId);
    const userId = normalizeId(rawUserId);

    console.log(`[Circle User Profile] User ${user.id} viewing profile ${userId} in circle ${circleId}`);

    // Get user profile with circle context
    const profile = await UserService.getUserPublicProfile(userId, user.id);

    // Progress in the circle's own metric. Optional: the header renders without it.
    let progressPercentage: number | null = null;
    let weights: { current: number | null; starting: number | null; target: number | null } | null = null;
    try {
      const progress = await MemberProgressService.getMemberCircleProgress(userId, user.id, circleId);
      if (progress.can_view) {
        if (progress.metric === 'weight') {
          const weight = await UserService.getUserProgress(userId, user.id, circleId);
          weights = { current: weight.current_weight, starting: weight.starting_weight, target: weight.target_weight };
          progressPercentage = weight.progress_percentage || null;
        } else {
          progressPercentage = progress.summary.progress_percentage || null;
        }
      }
    } catch (error) {
      // Progress data is optional, ignore errors
      console.warn(`[Circle User Profile] Could not fetch progress data: ${error}`);
    }

    const response = NextResponse.json(
      {
        success: true,
        data: {
          user_id: profile.user_id,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url,
          is_current_user: userId === user.id,
          privacy_settings: profile.privacy,
          progress_percentage: progressPercentage,
          current_weight: weights?.current || null,
          starting_weight: weights?.starting || null,
          target_weight: weights?.target || null,
          weight_unit: weights ? 'kg' : null,
        },
        error: null,
        meta: {
          requestTime: Date.now(),
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store'
        },
      }
    );

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Circle User Profile] Error:', error);

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

    if (error.message?.includes('private') || error.message?.includes('not found')) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: error.message || 'Cannot access this profile',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
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

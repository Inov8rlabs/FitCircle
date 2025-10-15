import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { UserService } from '@/lib/services/user-service';

/**
 * GET /api/mobile/users/[userId]/profile
 * Get public profile information for a user
 *
 * Privacy Rules:
 * - If profile_visibility is "private" and requester is not the user, return 403
 * - If profile_visibility is "friends" and requester is not in same circle, return 403
 * - Always return basic info (display_name, avatar_url) even if some fields are hidden
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "user_id": "uuid",
 *     "display_name": "John Doe",
 *     "avatar_url": "https://...",
 *     "privacy": {
 *       "profile_visibility": "public|friends|private",
 *       "show_weight": true,
 *       "show_progress": true
 *     },
 *     "stats": {
 *       "total_circles": 5,
 *       "circles_completed": 2,
 *       "current_streak": 7
 *     }
 *   }
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const requester = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { userId } = await params;

    console.log(`[Mobile API] Get user profile: userId=${userId}, requesterId=${requester.id}`);

    // Validate userId format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_USER_ID',
            message: 'Invalid user ID format',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Get user public profile
    const profile = await UserService.getUserPublicProfile(userId, requester.id);

    const response = NextResponse.json({
      success: true,
      data: profile,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (5 minutes cache for profile data)
    response.headers.set('Cache-Control', 'private, max-age=300');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get user profile error:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

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

    if (error.message === 'User not found') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Privacy-related errors
    if (
      error.message === 'This profile is private' ||
      error.message === 'This profile is only visible to circle members' ||
      error.message === 'Access denied'
    ) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: error.message,
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
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

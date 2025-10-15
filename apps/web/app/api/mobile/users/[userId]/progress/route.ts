import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { UserService } from '@/lib/services/user-service';

/**
 * GET /api/mobile/users/[userId]/progress
 * Get weight progress data for a user (respects privacy settings)
 *
 * Query Params:
 * - circle_id (optional) - Filter for specific circle
 *
 * Privacy Rules:
 * - If show_weight is false, return 403 with message "Weight data is private"
 * - If show_progress is false, return limited data (only progress_percentage)
 * - Allow user to view their own data regardless of privacy settings
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "starting_weight": 94.1,
 *     "current_weight": 93.1,
 *     "target_weight": 84.0,
 *     "progress_percentage": 9,
 *     "weight_lost": 1.0,
 *     "weight_to_go": 9.1,
 *     "last_updated": "2025-10-10T12:00:00Z"
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

    console.log(`[Mobile API] Get user progress: userId=${userId}, requesterId=${requester.id}`);

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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const circleId = searchParams.get('circle_id');

    // Validate circleId if provided
    if (circleId && !uuidRegex.test(circleId)) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_CIRCLE_ID',
            message: 'Invalid circle ID format',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Get user progress
    const progress = await UserService.getUserProgress(
      userId,
      requester.id,
      circleId || undefined
    );

    const response = NextResponse.json({
      success: true,
      data: progress,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (2 minutes cache for progress data)
    response.headers.set('Cache-Control', 'private, max-age=120');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get user progress error:', {
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
    if (error.message === 'Weight data is private') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Weight data is private',
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

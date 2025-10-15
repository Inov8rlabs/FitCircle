import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { UserService } from '@/lib/services/user-service';

/**
 * GET /api/mobile/users/[userId]/history
 * Get check-in history for a user (respects privacy settings)
 *
 * Query Params:
 * - circle_id (optional) - Filter for specific circle
 * - limit (default: 30) - Number of entries to return
 * - offset (default: 0) - Pagination offset
 *
 * Privacy Rules:
 * - Filter entries by is_public flag if requester is not the user
 * - If show_progress is false, return empty array with message
 * - Allow user to view their own data regardless of privacy settings
 *
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "entries": [
 *       {
 *         "id": "uuid",
 *         "date": "2025-10-10",
 *         "weight": 93.1,
 *         "weight_change": -0.15,
 *         "is_public": true,
 *         "note": "Feeling great!"
 *       }
 *     ],
 *     "total_count": 42,
 *     "has_more": true
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

    console.log(`[Mobile API] Get user history: userId=${userId}, requesterId=${requester.id}`);

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

    // Parse and validate query parameters
    const { searchParams } = new URL(request.url);
    const circleId = searchParams.get('circle_id');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

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

    // Parse and validate pagination parameters
    let limit = 30;
    let offset = 0;

    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'INVALID_LIMIT',
              message: 'Limit must be between 1 and 100',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 400 }
        );
      }
      limit = parsedLimit;
    }

    if (offsetParam) {
      const parsedOffset = parseInt(offsetParam, 10);
      if (isNaN(parsedOffset) || parsedOffset < 0) {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'INVALID_OFFSET',
              message: 'Offset must be a non-negative integer',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 400 }
        );
      }
      offset = parsedOffset;
    }

    console.log(`[Mobile API] History params: circleId=${circleId}, limit=${limit}, offset=${offset}`);

    // Get user history
    const history = await UserService.getUserHistory(userId, requester.id, {
      circleId: circleId || undefined,
      limit,
      offset,
    });

    const response = NextResponse.json({
      success: true,
      data: history,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });

    // Add cache headers (2 minutes cache for history data)
    response.headers.set('Cache-Control', 'private, max-age=120');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Get user history error:', {
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

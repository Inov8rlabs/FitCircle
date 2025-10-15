import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { UserService } from '@/lib/services/user-service';

/**
 * GET /api/mobile/circles/[id]/users/[userId]/history
 * Get user check-in history within circle context
 *
 * Query params:
 * - limit: number (default: 30, max: 100)
 * - offset: number (default: 0)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId, userId } = await params;

    // Get query params
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    console.log(`[Circle User History] User ${user.id} viewing history ${userId} in circle ${circleId} (limit: ${limit}, offset: ${offset})`);

    // Get user history with circle context
    const history = await UserService.getUserHistory(userId, user.id, circleId, limit, offset);

    const response = NextResponse.json(
      {
        success: true,
        data: history,
        error: null,
        meta: {
          requestTime: Date.now(),
          limit,
          offset,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=120', // 2 minutes
        },
      }
    );

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Circle User History] Error:', error);

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

    if (error.message?.includes('private') || error.message?.includes('Progress data')) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: error.message || 'Cannot access history data',
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

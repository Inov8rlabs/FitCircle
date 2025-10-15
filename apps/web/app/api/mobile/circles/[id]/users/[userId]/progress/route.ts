import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { UserService } from '@/lib/services/user-service';

/**
 * GET /api/mobile/circles/[id]/users/[userId]/progress
 * Get user weight progress within circle context
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId, userId } = await params;

    console.log(`[Circle User Progress] User ${user.id} viewing progress ${userId} in circle ${circleId}`);

    // Get user progress with circle context
    const progress = await UserService.getUserProgress(userId, user.id, circleId);

    const response = NextResponse.json(
      {
        success: true,
        data: progress,
        error: null,
        meta: {
          requestTime: Date.now(),
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

    if (error.message?.includes('private') || error.message?.includes('Weight data')) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: error.message || 'Cannot access weight data',
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

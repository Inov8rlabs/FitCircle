import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { UserService } from '@/lib/services/user-service';

/**
 * GET /api/mobile/circles/[id]/users/[userId]/profile
 * Get user profile within circle context
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId, userId } = await params;

    console.log(`[Circle User Profile] User ${user.id} viewing profile ${userId} in circle ${circleId}`);

    // Get user profile with circle context
    const profile = await UserService.getUserPublicProfile(userId, user.id);

    const response = NextResponse.json(
      {
        success: true,
        data: profile,
        error: null,
        meta: {
          requestTime: Date.now(),
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=300', // 5 minutes
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

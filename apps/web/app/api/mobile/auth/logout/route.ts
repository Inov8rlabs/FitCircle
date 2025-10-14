import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

/**
 * POST /api/mobile/auth/logout
 * Logout user by blacklisting their current access token
 *
 * Headers:
 * - Authorization: Bearer <access_token>
 *
 * Response:
 * - 200: Successfully logged out
 * - 401: Unauthorized (invalid or missing token)
 * - 500: Internal server error
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Extract access token from header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Missing or invalid authorization header',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    const accessToken = authHeader.substring(7);

    // Blacklist the token
    await MobileAPIService.blacklistToken(accessToken, user.id, 'logout');

    console.log(`[LOGOUT] User ${user.id} logged out successfully`);

    return NextResponse.json({
      success: true,
      data: {
        message: 'Successfully logged out',
        logged_out_at: new Date().toISOString(),
      },
      error: null,
      meta: null,
    });
  } catch (error: any) {
    console.error('Logout error:', error);

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

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

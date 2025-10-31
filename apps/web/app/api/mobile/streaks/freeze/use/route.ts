import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { useFreeze } from '@/lib/services/daily-checkin-service';

/**
 * POST /api/mobile/streaks/freeze/use
 * Manually use a freeze for planned absence
 *
 * Request Body: {} (empty)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     success: boolean,
 *     freezesRemaining: number,
 *     message: string
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Use a freeze
    const result = await useFreeze(user.id, supabaseAdmin);

    const statusCode = result.success ? 200 : 400;

    const response = NextResponse.json(
      {
        success: result.success,
        data: result,
        error: result.success
          ? null
          : {
              code: 'FREEZE_UNAVAILABLE',
              message: result.message,
              details: {},
              timestamp: new Date().toISOString(),
            },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: statusCode }
    );

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Use freeze error:', error);

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
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

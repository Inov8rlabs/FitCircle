import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MomentumService } from '@/lib/services/momentum-service';

/**
 * POST /api/mobile/momentum/check-in
 * Manual momentum check-in. Also auto-triggered by exercise logging.
 * Idempotent: duplicate same-day check-ins return current state.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const result = await MomentumService.checkIn(user.id);

    return NextResponse.json({
      success: true,
      data: result,
      error: null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[POST /api/mobile/momentum/check-in] Error:', error);

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
          message: 'Failed to process momentum check-in',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

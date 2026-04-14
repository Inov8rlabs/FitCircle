import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MomentumService } from '@/lib/services/momentum-service';

/**
 * GET /api/mobile/momentum/status
 * Returns full momentum status for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const status = await MomentumService.getStatus(user.id);

    return NextResponse.json({
      success: true,
      data: status,
      error: null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[GET /api/mobile/momentum/status] Error:', error);

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
          message: 'Failed to fetch momentum status',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

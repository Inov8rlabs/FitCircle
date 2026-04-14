import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MomentumService } from '@/lib/services/momentum-service';

/**
 * GET /api/mobile/momentum/milestones
 * Returns unlocked milestones with unlock dates.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const milestones = await MomentumService.getMilestones(user.id);

    return NextResponse.json({
      success: true,
      data: { milestones },
      error: null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[GET /api/mobile/momentum/milestones] Error:', error);

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
          message: 'Failed to fetch milestones',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

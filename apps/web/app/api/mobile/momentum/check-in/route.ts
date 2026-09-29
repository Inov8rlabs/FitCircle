import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MomentumService } from '@/lib/services/momentum-service';

/**
 * POST /api/mobile/momentum/check-in
 * Manual momentum check-in. Also auto-triggered by exercise logging.
 * Idempotent: duplicate same-day check-ins return current state.
 *
 * `data` is the check-in result (`new_momentum`, `milestone_achieved`, ...)
 * plus, as additional keys, every field of GET /api/mobile/momentum/status, so
 * a client that decodes the status model from this response can.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const result = await MomentumService.checkIn(user.id);

    // The check-in already succeeded; a failed status read must not fail it.
    let status: Record<string, unknown> = {};
    try {
      status = { ...(await MomentumService.getStatus(user.id)) };
    } catch (statusError) {
      console.error('[POST /api/mobile/momentum/check-in] status read error:', statusError);
    }

    return NextResponse.json({
      success: true,
      // Result keys win where both objects have one (they describe the same state).
      data: { ...status, ...result },
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

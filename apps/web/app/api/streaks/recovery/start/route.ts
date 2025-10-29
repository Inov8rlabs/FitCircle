import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase-server';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { StreakClaimError } from '@/lib/types/streak-claiming';

// Validation schema
const startRecoverySchema = z.object({
  brokenDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recoveryType: z.enum(['weekend_warrior', 'purchased']),
});

/**
 * POST /api/streaks/recovery/start
 * Start a streak recovery attempt
 *
 * Request body:
 * {
 *   "brokenDate": "2025-10-28",
 *   "recoveryType": "weekend_warrior" | "purchased"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "recovery": { ... },
 *   "actionsRequired": 2,
 *   "actionsRemaining": 2,
 *   "expiresAt": "2025-10-30T12:00:00Z"
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Verify authentication
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        },
        { status: 401 }
      );
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const { brokenDate, recoveryType } = startRecoverySchema.parse(body);

    // 3. Start recovery
    const targetDate = new Date(brokenDate);
    const recoveryInfo = await StreakClaimingService.startRecovery(
      user.id,
      targetDate,
      recoveryType
    );

    console.log(
      `[POST /api/streaks/recovery/start] User ${user.id} started ${recoveryType} recovery for ${brokenDate}`
    );

    return NextResponse.json({
      success: true,
      recovery: recoveryInfo.recovery,
      actionsRequired: recoveryInfo.recovery.actions_required || 0,
      actionsRemaining: recoveryInfo.actionsRemaining,
      expiresAt: recoveryInfo.timeRemaining,
    });
  } catch (error: any) {
    console.error('[POST /api/streaks/recovery/start] Error:', error);

    if (error instanceof StreakClaimError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        },
        { status: 400 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        },
      },
      { status: 500 }
    );
  }
}

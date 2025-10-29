import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

/**
 * GET /api/streaks/shields
 * Get user's available streak shields by type
 *
 * Response:
 * {
 *   "freezes": 1,
 *   "milestone_shields": 2,
 *   "purchased": 0,
 *   "total": 3,
 *   "last_freeze_reset": "2025-10-21T00:00:00Z",
 *   "next_freeze_reset": "2025-10-28T00:00:00Z"
 * }
 */
export async function GET(request: NextRequest) {
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

    // 2. Get shield status
    const shields = await StreakClaimingService.getAvailableShields(user.id);

    return NextResponse.json(shields);
  } catch (error: any) {
    console.error('[GET /api/streaks/shields] Error:', error);

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

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
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
    // 1. Verify mobile authentication (Bearer token)
    const user = await requireMobileAuth(request);

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

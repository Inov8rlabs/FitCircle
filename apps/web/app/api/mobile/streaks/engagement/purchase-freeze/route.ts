import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * POST /api/mobile/streaks/engagement/purchase-freeze
 * Purchase additional streak freeze (100 XP or $0.99)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    console.log('[POST /api/mobile/streaks/engagement/purchase-freeze] User:', user.id);

    // Parse request body
    const body = await request.json();
    const { payment_method } = body; // 'xp' or 'money'

    // TODO: Implement payment/XP deduction logic here
    // For now, just purchase the freeze

    // Purchase freeze
    await EngagementStreakService.purchaseFreeze(user.id);

    return NextResponse.json({
      success: true,
      message: 'Freeze purchased successfully',
      payment_method: payment_method || 'xp',
    });

  } catch (error: any) {
    console.error('[POST /api/mobile/streaks/engagement/purchase-freeze] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    // Handle specific error types
    if (error instanceof Error && error.message.includes('maximum')) {
      return NextResponse.json(
        { success: false, error: error.message, data: null },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: false, error: 'Failed to purchase freeze', data: null },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

/**
 * GET /api/cron/streaks/weekly-reset
 * Weekly cron job to reset free freezes
 *
 * Runs every Monday at 00:00 UTC
 * Protected by CRON_SECRET
 *
 * This job:
 * 1. Adds 1 free freeze to all users (up to max 5)
 * 2. Updates last_reset_at timestamp
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.error('[Cron Weekly Reset] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Weekly Reset] Starting weekly freeze reset...');

    const startTime = Date.now();

    // Reset weekly freezes
    await StreakClaimingService.resetWeeklyFreezes();

    const duration = Date.now() - startTime;

    console.log(`[Cron Weekly Reset] Completed in ${duration}ms`);

    return NextResponse.json({
      success: true,
      message: 'Weekly freeze reset completed',
      stats: {
        duration_ms: duration,
      },
    });
  } catch (error: any) {
    console.error('[Cron Weekly Reset] Fatal error:', error);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'An unexpected error occurred',
        },
      },
      { status: 500 }
    );
  }
}

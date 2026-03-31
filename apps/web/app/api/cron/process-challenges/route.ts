import { NextRequest, NextResponse } from 'next/server';
import { ChallengeService } from '@/lib/services/circle-challenge-service';

/**
 * GET /api/cron/process-challenges
 * Cron job to activate scheduled challenges and complete ended ones.
 * Secured with CRON_SECRET header.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('[Cron] Processing challenge status transitions...');

    const result = await ChallengeService.processScheduledChallenges();

    console.log(`[Cron] Activated ${result.activated} challenges, completed ${result.completed} challenges`);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('[Cron] Error processing challenges:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

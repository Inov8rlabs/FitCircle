import { NextRequest, NextResponse } from 'next/server';
import { ChallengeService } from '@/lib/services/challenge-service';

/**
 * Cron job endpoint to process challenge status updates
 * Should be called daily via a cron service like Vercel Cron or external service
 *
 * Protect this endpoint with a cron secret in production
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (optional but recommended for production)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Process challenge status updates
    await ChallengeService.processChallengeStatusUpdates();

    // Process streak achievements
    await ChallengeService.processStreakAchievements();

    return NextResponse.json({
      success: true,
      message: 'Challenge status updates and achievements processed',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process cron job' },
      { status: 500 }
    );
  }
}

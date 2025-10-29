import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

/**
 * GET /api/cron/streaks/daily-check
 * Daily cron job to check for broken streaks and auto-apply shields
 *
 * Runs daily at midnight UTC
 * Protected by CRON_SECRET
 *
 * This job:
 * 1. Checks all users who didn't claim yesterday
 * 2. Auto-applies shields if available
 * 3. Resets streaks if no shields available
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.error('[Cron Daily Check] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Daily Check] Starting daily streak check...');

    const supabaseAdmin = createAdminSupabase();
    const startTime = Date.now();

    // Get all users with engagement streaks
    const { data: users, error: usersError } = await supabaseAdmin
      .from('engagement_streaks')
      .select('user_id, current_streak')
      .gt('current_streak', 0) // Only check users with active streaks
      .eq('paused', false); // Skip paused users

    if (usersError) {
      console.error('[Cron Daily Check] Error fetching users:', usersError);
      throw usersError;
    }

    console.log(`[Cron Daily Check] Checking ${users?.length || 0} users with active streaks`);

    let brokenCount = 0;
    let shieldsApplied = 0;
    let errors = 0;

    // Check each user
    for (const user of users || []) {
      try {
        const isBroken = await StreakClaimingService.checkAndBreakStreak(user.user_id);
        if (isBroken) {
          brokenCount++;
        } else if (user.current_streak > 0) {
          // If streak wasn't broken but user had an active streak, a shield was likely applied
          shieldsApplied++;
        }
      } catch (error) {
        console.error(`[Cron Daily Check] Error checking user ${user.user_id}:`, error);
        errors++;
      }
    }

    const duration = Date.now() - startTime;

    console.log(
      `[Cron Daily Check] Completed in ${duration}ms: ${brokenCount} broken, ${shieldsApplied} shields applied, ${errors} errors`
    );

    return NextResponse.json({
      success: true,
      message: 'Daily streak check completed',
      stats: {
        total_checked: users?.length || 0,
        streaks_broken: brokenCount,
        shields_applied: shieldsApplied,
        errors,
        duration_ms: duration,
      },
    });
  } catch (error: any) {
    console.error('[Cron Daily Check] Fatal error:', error);

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

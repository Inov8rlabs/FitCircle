import { type NextRequest, NextResponse } from 'next/server';

import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

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
    let paywallEligibleCount = 0;
    let errors = 0;

    // Check users in bounded parallel batches (each check is several DB
    // round-trips in that user's own timezone — a fully serial loop would
    // outgrow the function timeout as the user base grows).
    const BATCH_SIZE = 25;
    const allUsers = users || [];
    for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
      const batch = allUsers.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async user => {
          try {
            const result = await StreakClaimingService.checkAndBreakStreak(user.user_id);
            if (result.broken) {
              brokenCount++;
              if (result.paywallEligible) {
                // Free user lost their streak with no shields left — prime
                // audience for the "Pro = unlimited shields" pitch.
                // TODO(notifications): send "streak lost — Pro protects it" push.
                paywallEligibleCount++;
              }
            } else if (result.shieldApplied) {
              shieldsApplied++;
              // TODO(notifications): send "a shield saved your streak" push.
            }
          } catch (error) {
            console.error(`[Cron Daily Check] Error checking user ${user.user_id}:`, error);
            errors++;
          }
        })
      );
    }

    const duration = Date.now() - startTime;

    console.log(
      `[Cron Daily Check] Completed in ${duration}ms: ${brokenCount} broken (${paywallEligibleCount} paywall-eligible), ${shieldsApplied} shields applied, ${errors} errors`
    );

    return NextResponse.json({
      success: true,
      message: 'Daily streak check completed',
      stats: {
        total_checked: users?.length || 0,
        streaks_broken: brokenCount,
        paywall_eligible: paywallEligibleCount,
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

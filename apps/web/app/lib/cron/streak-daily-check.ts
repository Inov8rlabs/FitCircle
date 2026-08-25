import { type NextRequest, NextResponse } from 'next/server';

import { NotificationOrchestrator } from '../services/notification-orchestrator';
import { StreakClaimingService } from '../services/streak-claiming-service';
import { createAdminSupabase } from '../supabase-admin';

/**
 * Shared body of the daily streak protect-or-break cron. Two routes call
 * this (00:00 and 04:00 UTC) because Vercel identifies cron jobs by path.
 */
export async function runDailyStreakCheck(request: NextRequest) {
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

    // Page through every user with an active streak. PostgREST caps a
    // single select at 1000 rows, which silently skipped everyone past that.
    const PAGE_SIZE = 1000;
    const allUsers: { user_id: string }[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: usersError } = await supabaseAdmin
        .from('engagement_streaks')
        .select('user_id')
        .gt('current_streak', 0) // Only check users with active streaks
        .or('paused.is.null,paused.eq.false') // Skip paused users (NULL = not paused)
        .order('user_id')
        .range(from, from + PAGE_SIZE - 1);
      if (usersError) {
        console.error('[Cron Daily Check] Error fetching users:', usersError);
        throw usersError;
      }
      allUsers.push(...(page || []));
      if (!page || page.length < PAGE_SIZE) break;
    }

    console.log(`[Cron Daily Check] Checking ${allUsers.length} users with active streaks`);

    let brokenCount = 0;
    let shieldsApplied = 0;
    let paywallEligibleCount = 0;
    let notified = 0;
    let errors = 0;

    // Check users in bounded parallel batches (each check is several DB
    // round-trips in that user's own timezone — a fully serial loop would
    // outgrow the function timeout as the user base grows).
    const BATCH_SIZE = 25;
    for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
      const batch = allUsers.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async user => {
          try {
            const result = await StreakClaimingService.checkAndBreakStreak(user.user_id);
            if (result.broken) {
              brokenCount++;
              if (result.paywallEligible) paywallEligibleCount++;
              // Tell them what happened and how to start again. The
              // orchestrator handles quiet hours / caps / preferences.
              const sent = await NotificationOrchestrator.send(user.user_id, 'streak_lost', {
                lostStreak: result.lostStreak,
                paywallEligible: result.paywallEligible,
                zombieGuard: result.zombieGuard === true,
                deepLink: 'fitcircle://streaks',
              });
              if (sent.sent) notified++;
            } else if (result.shieldApplied) {
              shieldsApplied++;
              const sent = await NotificationOrchestrator.send(user.user_id, 'shield_applied', {
                streakDays: result.currentStreak,
                shieldsRemaining: result.shieldsRemaining,
                unlimited: result.unlimited,
                lastAutoProtect: result.lastAutoProtect === true,
                deepLink: 'fitcircle://streaks',
              });
              if (sent.sent) notified++;
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
      `[Cron Daily Check] Completed in ${duration}ms: ${brokenCount} broken (${paywallEligibleCount} paywall-eligible), ${shieldsApplied} shields applied, ${notified} notified, ${errors} errors`
    );

    return NextResponse.json({
      success: true,
      message: 'Daily streak check completed',
      stats: {
        total_checked: allUsers.length,
        streaks_broken: brokenCount,
        paywall_eligible: paywallEligibleCount,
        shields_applied: shieldsApplied,
        notified,
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

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/cron/streaks/cleanup-recoveries
 * Hourly cron job to clean up expired recovery attempts
 *
 * Runs every hour
 * Protected by CRON_SECRET
 *
 * This job:
 * 1. Finds all pending recoveries with expired timestamps
 * 2. Updates their status to 'expired'
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.error('[Cron Cleanup Recoveries] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Cleanup Recoveries] Starting recovery cleanup...');

    const supabaseAdmin = createAdminSupabase();
    const startTime = Date.now();
    const now = new Date().toISOString();

    // Update expired recoveries
    const { data, error } = await supabaseAdmin
      .from('streak_recoveries')
      .update({ recovery_status: 'expired' })
      .eq('recovery_status', 'pending')
      .lt('expires_at', now)
      .select('id');

    if (error) {
      console.error('[Cron Cleanup Recoveries] Error updating recoveries:', error);
      throw error;
    }

    const expiredCount = data?.length || 0;
    const duration = Date.now() - startTime;

    console.log(`[Cron Cleanup Recoveries] Completed in ${duration}ms: ${expiredCount} recoveries expired`);

    return NextResponse.json({
      success: true,
      message: 'Recovery cleanup completed',
      stats: {
        expired_count: expiredCount,
        duration_ms: duration,
      },
    });
  } catch (error: any) {
    console.error('[Cron Cleanup Recoveries] Fatal error:', error);

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

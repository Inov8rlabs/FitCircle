/**
 * API Route: /api/cron/generate-daily-goals
 *
 * Generate daily goals for all users (run at midnight per timezone)
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret, createAdminSupabase } from '@/lib/utils/api-auth';
import { generateDailyGoals } from '@/lib/services/goal-service';

/**
 * GET /api/cron/generate-daily-goals
 *
 * Generate today's daily goals for all users
 * Requires: CRON_SECRET in authorization header
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();
    const today = new Date().toISOString().split('T')[0];

    // Get all active users (users who have checked in within last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: activeUsers, error: usersError } = await supabase
      .from('daily_tracking')
      .select('user_id')
      .gte('tracking_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('tracking_date', { ascending: false });

    if (usersError) {
      return NextResponse.json(
        { error: 'Failed to fetch active users', details: usersError.message },
        { status: 500 }
      );
    }

    // Get unique user IDs
    const uniqueUserIds = [...new Set((activeUsers || []).map(t => t.user_id))];

    // Generate goals for each user
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const userId of uniqueUserIds) {
      const { goals, error } = await generateDailyGoals(userId, today, supabase);

      if (error) {
        errorCount++;
        errors.push(`User ${userId}: ${error.message}`);
      } else {
        successCount++;
      }
    }

    return NextResponse.json({
      success: true,
      date: today,
      total_users: uniqueUserIds.length,
      success_count: successCount,
      error_count: errorCount,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error('Generate daily goals cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

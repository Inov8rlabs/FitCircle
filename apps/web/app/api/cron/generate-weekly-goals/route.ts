/**
 * API Route: /api/cron/generate-weekly-goals
 *
 * Generate weekly goals for all users (run Mondays at midnight)
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret, createAdminSupabase } from '@/lib/utils/api-auth';
import { generateWeeklyGoals, getWeekStart } from '@/lib/services/goal-service';

/**
 * GET /api/cron/generate-weekly-goals
 *
 * Generate this week's weekly goals for all users
 * Requires: CRON_SECRET in authorization header
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();
    const weekStart = getWeekStart();

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

    // Generate goals for each user (both personal and FitCircle goals)
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    for (const userId of uniqueUserIds) {
      // Generate personal weekly goals (no FitCircle)
      const { error: personalError } = await generateWeeklyGoals(userId, weekStart, null, supabase);

      if (personalError) {
        errorCount++;
        errors.push(`User ${userId} (personal): ${personalError.message}`);
      } else {
        successCount++;
      }

      // Get user's FitCircles and generate goals for each
      const { data: memberships } = await supabase
        .from('circle_members')
        .select('circle_id')
        .eq('user_id', userId)
        .eq('is_active', true);

      for (const membership of memberships || []) {
        const { error: fitcircleError } = await generateWeeklyGoals(
          userId,
          weekStart,
          membership.circle_id,
          supabase
        );

        if (fitcircleError) {
          errorCount++;
          errors.push(`User ${userId} (FitCircle ${membership.circle_id}): ${fitcircleError.message}`);
        } else {
          successCount++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      week_start: weekStart,
      total_users: uniqueUserIds.length,
      success_count: successCount,
      error_count: errorCount,
      errors: errors.slice(0, 10), // Return first 10 errors
    });
  } catch (error) {
    console.error('Generate weekly goals cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

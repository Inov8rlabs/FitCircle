/**
 * API Route: /api/goals/weekly
 *
 * Handles fetching and generating weekly goals
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import {
  getCurrentWeeklyGoals,
  generateWeeklyGoals,
  getWeeklyGoalHistory,
  getTeamWeeklyPerformance,
  getWeekStart,
} from '@/lib/services/goal-service';

/**
 * GET /api/goals/weekly
 * Query params:
 * - weeks: number (optional) - Get history for N weeks
 * - fitcircle_id: string (optional) - Filter by FitCircle
 * - team: boolean (optional) - Get team aggregated performance
 *
 * Fetch current week's goals or weekly history
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const historyWeeks = searchParams.get('weeks');
    const fitcircleId = searchParams.get('fitcircle_id');
    const isTeamRequest = searchParams.get('team') === 'true';

    const supabase = createAdminSupabase();

    // Team aggregated performance request
    if (isTeamRequest && fitcircleId) {
      const weekStart = getWeekStart();
      const { totalSteps, averageCompletion, memberCount, error } = await getTeamWeeklyPerformance(
        fitcircleId,
        weekStart,
        supabase
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        fitcircle_id: fitcircleId,
        week_start: weekStart,
        total_steps: totalSteps,
        average_completion: averageCompletion,
        member_count: memberCount,
      });
    }

    // Weekly goal history request
    if (historyWeeks) {
      const weeks = parseInt(historyWeeks, 10);
      if (isNaN(weeks) || weeks < 1 || weeks > 52) {
        return NextResponse.json({ error: 'Invalid weeks parameter (1-52)' }, { status: 400 });
      }

      const { goals, error } = await getWeeklyGoalHistory(user.id, weeks, fitcircleId, supabase);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ goals });
    }

    // Current week's goals
    const { goals, error } = await getCurrentWeeklyGoals(user.id, fitcircleId, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ goals });
  } catch (error) {
    console.error('Get weekly goals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/goals/weekly
 * Body: { week_start?: string, fitcircle_id?: string }
 *
 * Generate personalized weekly goals
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const weekStart = body.week_start || getWeekStart();
    const fitcircleId = body.fitcircle_id || null;

    const supabase = createAdminSupabase();

    const { goals, error } = await generateWeeklyGoals(user.id, weekStart, fitcircleId, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ goals, generated: true });
  } catch (error) {
    console.error('Generate weekly goals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

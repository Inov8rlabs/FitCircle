/**
 * API Route: /api/goals/daily
 *
 * Handles fetching and generating daily goals
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { getTodayDailyGoals, generateDailyGoals, getDailyGoalHistory } from '@/lib/services/goal-service';

/**
 * GET /api/goals/daily
 * Query params:
 * - history: number (optional) - Get history for N days
 *
 * Fetch today's daily goals or goal history
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const historyDays = searchParams.get('days');

    const supabase = createAdminSupabase();

    if (historyDays) {
      // Fetch goal history
      const days = parseInt(historyDays, 10);
      if (isNaN(days) || days < 1 || days > 365) {
        return NextResponse.json({ error: 'Invalid days parameter (1-365)' }, { status: 400 });
      }

      const { goals, error } = await getDailyGoalHistory(user.id, days, supabase);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ goals });
    }

    // Fetch today's goals
    const { goals, error } = await getTodayDailyGoals(user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ goals });
  } catch (error) {
    console.error('Get daily goals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/goals/daily
 * Body: { date?: string }
 *
 * Generate personalized daily goals (defaults to today)
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const date = body.date || new Date().toISOString().split('T')[0];

    const supabase = createAdminSupabase();

    const { goals, error } = await generateDailyGoals(user.id, date, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ goals, generated: true });
  } catch (error) {
    console.error('Generate daily goals error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

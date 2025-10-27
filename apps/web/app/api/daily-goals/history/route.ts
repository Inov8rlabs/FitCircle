/**
 * Daily Goals History API
 *
 * GET /api/daily-goals/history - Get completion history
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { DailyGoalService } from '@/lib/services/daily-goals';

/**
 * GET /api/daily-goals/history
 * Get completion history for the authenticated user
 *
 * Query params:
 * - limit: Number of records to fetch (default: 30)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '30', 10);

    // Fetch completion history
    const { data: history, error } = await DailyGoalService.getCompletionHistory(
      user.id,
      limit,
      supabase
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ history }, { status: 200 });
  } catch (error) {
    console.error('Error fetching completion history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

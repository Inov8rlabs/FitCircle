/**
 * Daily Goals API Routes
 *
 * GET  /api/daily-goals - Fetch user's active daily goals
 * POST /api/daily-goals - Create/update daily goals
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase-server';
import { DailyGoalService } from '@/lib/services/daily-goals';

// Validation schema for POST
const createGoalSchema = z.object({
  challenge_id: z.string().uuid().optional(),
  goals: z.array(z.object({
    goal_type: z.enum(['steps', 'weight_log', 'workout', 'mood', 'energy', 'custom']),
    target_value: z.number().positive().optional(),
    unit: z.string().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    frequency: z.enum(['daily', 'weekdays', 'weekends', 'custom']).optional(),
    is_primary: z.boolean().optional(),
  })).optional(),
});

/**
 * GET /api/daily-goals
 * Fetch active daily goals for the authenticated user
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

    // Fetch daily goals
    const { data: goals, error } = await DailyGoalService.getUserDailyGoals(user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ goals }, { status: 200 });
  } catch (error) {
    console.error('Error fetching daily goals:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/daily-goals
 * Create daily goals for a challenge or manually
 *
 * Body:
 * - challenge_id (optional): Create goals from challenge
 * - goals (optional): Manually create specific goals
 */
export async function POST(request: NextRequest) {
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

    // Parse and validate request body
    const body = await request.json();
    const validationResult = createGoalSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request data',
          details: validationResult.error.errors
        },
        { status: 400 }
      );
    }

    const { challenge_id, goals: manualGoals } = validationResult.data;

    // If challenge_id provided, create goals from challenge
    if (challenge_id) {
      const { success, goals, error } = await DailyGoalService.createDailyGoalsForChallenge(
        user.id,
        challenge_id,
        supabase
      );

      if (!success || error) {
        return NextResponse.json({ error: error?.message || 'Failed to create goals' }, { status: 500 });
      }

      return NextResponse.json({ goals }, { status: 201 });
    }

    // If manual goals provided, insert them
    if (manualGoals && Array.isArray(manualGoals)) {
      const today = new Date().toISOString().split('T')[0];

      const goalsToInsert = manualGoals.map(g => ({
        user_id: user.id,
        challenge_id: null, // Personal goals have no challenge
        goal_type: g.goal_type,
        target_value: g.target_value,
        unit: g.unit,
        frequency: g.frequency || 'daily',
        start_date: g.start_date || today,
        end_date: g.end_date || null,
        is_active: true,
        is_primary: g.is_primary || false,
      }));

      const { data, error } = await supabase
        .from('daily_goals')
        .insert(goalsToInsert)
        .select();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ goals: data }, { status: 201 });
    }

    return NextResponse.json({ error: 'Missing challenge_id or goals' }, { status: 400 });
  } catch (error) {
    console.error('Error creating daily goals:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

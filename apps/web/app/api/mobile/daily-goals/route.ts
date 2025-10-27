import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { DailyGoalService } from '@/lib/services/daily-goals';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * Validation schema for creating daily goal
 */
const createGoalSchema = z.object({
  goal_type: z.enum(['steps', 'weight_log', 'workout', 'mood', 'energy', 'custom']),
  target_value: z.number().positive().optional(),
  unit: z.string().optional(),
  start_date: z.string().optional(), // Accept any date string, will normalize to YYYY-MM-DD
  end_date: z.string().optional().nullable(),
  frequency: z.enum(['daily', 'weekdays', 'weekends', 'custom']).optional(),
  is_primary: z.boolean().optional(),
  challenge_id: z.string().uuid().optional().nullable(),
  auto_adjust_enabled: z.boolean().optional(), // iOS sends this
});

/**
 * GET /api/mobile/daily-goals
 * Fetch active daily goals for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    console.log(`[Mobile Daily Goals] Fetching goals for user: ${user.id}`);

    // Fetch daily goals
    const { data: goals, error } = await DailyGoalService.getUserDailyGoals(user.id, supabaseAdmin);

    if (error) {
      console.error('[Mobile Daily Goals] Error fetching goals:', error);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FETCH_ERROR',
            message: error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    console.log(`[Mobile Daily Goals] Found ${goals?.length || 0} active goals`);

    const response = NextResponse.json({
      success: true,
      data: goals || [],
      error: null,
      meta: {
        requestTime: Date.now(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Mobile Daily Goals] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/daily-goals
 * Create a new daily goal
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();

    console.log(`[Mobile Daily Goals] Creating goal for user: ${user.id}`, body);

    // Validate input
    const validationResult = createGoalSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validationResult.error.errors,
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const supabaseAdmin = createAdminSupabase();
    const today = new Date().toISOString().split('T')[0];
    const goalData = validationResult.data;

    // Normalize date strings (iOS sends full timestamps, we need YYYY-MM-DD)
    const normalizeDate = (dateStr: string | undefined | null): string | null => {
      if (!dateStr) return null;
      // Extract date part from ISO8601 timestamp or use as-is if already a date
      return dateStr.split('T')[0];
    };

    const startDate = normalizeDate(goalData.start_date) || today;
    const endDate = normalizeDate(goalData.end_date);

    console.log(`[Mobile Daily Goals] Normalized dates - start: ${startDate}, end: ${endDate}`);

    // Check for existing active goal of same type (prevent duplicates)
    const { data: existingGoal } = await supabaseAdmin
      .from('daily_goals')
      .select('id')
      .eq('user_id', user.id)
      .eq('goal_type', goalData.goal_type)
      .eq('is_active', true)
      .lte('start_date', today)
      .or(`end_date.is.null,end_date.gte.${today}`)
      .maybeSingle();

    if (existingGoal) {
      console.log(`[Mobile Daily Goals] User already has active ${goalData.goal_type} goal: ${existingGoal.id}`);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'DUPLICATE_GOAL',
            message: `You already have an active ${goalData.goal_type} goal`,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 409 }
      );
    }

    // Insert goal
    const { data, error } = await supabaseAdmin
      .from('daily_goals')
      .insert({
        user_id: user.id,
        challenge_id: goalData.challenge_id || null,
        goal_type: goalData.goal_type,
        target_value: goalData.target_value,
        unit: goalData.unit,
        frequency: goalData.frequency || 'daily',
        start_date: startDate,
        end_date: endDate,
        is_active: true,
        is_primary: goalData.is_primary || false,
        auto_adjust_enabled: goalData.auto_adjust_enabled || false,
      })
      .select()
      .single();

    if (error) {
      console.error('[Mobile Daily Goals] Error creating goal:', error);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'CREATE_ERROR',
            message: error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    console.log(`[Mobile Daily Goals] Goal created successfully:`, data.id);

    const response = NextResponse.json({
      success: true,
      data: data,
      error: null,
      meta: {
        requestTime: Date.now(),
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Mobile Daily Goals] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

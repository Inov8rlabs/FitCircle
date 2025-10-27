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
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  frequency: z.enum(['daily', 'weekdays', 'weekends', 'custom']).optional(),
  is_primary: z.boolean().optional(),
  challenge_id: z.string().uuid().optional().nullable(),
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
        start_date: goalData.start_date || today,
        end_date: goalData.end_date || null,
        is_active: true,
        is_primary: goalData.is_primary || false,
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

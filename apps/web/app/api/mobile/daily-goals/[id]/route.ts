import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * Validation schema for updating daily goal
 */
const updateGoalSchema = z.object({
  target_value: z.number().positive().optional(),
  unit: z.string().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  frequency: z.enum(['daily', 'weekdays', 'weekends', 'custom']).optional(),
  is_active: z.boolean().optional(),
  is_primary: z.boolean().optional(),
});

/**
 * PATCH /api/mobile/daily-goals/[id]
 * Update a daily goal
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: goalId } = await params;
    const body = await request.json();

    console.log(`[Mobile Daily Goals] Updating goal ${goalId} for user: ${user.id}`);

    // Validate input
    const validationResult = updateGoalSchema.safeParse(body);

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

    // Verify ownership
    const { data: existingGoal, error: fetchError } = await supabaseAdmin
      .from('daily_goals')
      .select('user_id')
      .eq('id', goalId)
      .single();

    if (fetchError || !existingGoal) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Goal not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    if (existingGoal.user_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to update this goal',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Update goal
    const { data, error } = await supabaseAdmin
      .from('daily_goals')
      .update({
        ...validationResult.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', goalId)
      .select()
      .single();

    if (error) {
      console.error('[Mobile Daily Goals] Error updating goal:', error);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UPDATE_ERROR',
            message: error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    console.log(`[Mobile Daily Goals] Goal updated successfully`);

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

/**
 * DELETE /api/mobile/daily-goals/[id]
 * Delete a daily goal
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: goalId } = await params;

    console.log(`[Mobile Daily Goals] Deleting goal ${goalId} for user: ${user.id}`);

    const supabaseAdmin = createAdminSupabase();

    // Verify ownership
    const { data: existingGoal, error: fetchError } = await supabaseAdmin
      .from('daily_goals')
      .select('user_id')
      .eq('id', goalId)
      .single();

    if (fetchError || !existingGoal) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Goal not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    if (existingGoal.user_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to delete this goal',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Delete goal
    const { error } = await supabaseAdmin
      .from('daily_goals')
      .delete()
      .eq('id', goalId);

    if (error) {
      console.error('[Mobile Daily Goals] Error deleting goal:', error);
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'DELETE_ERROR',
            message: error.message,
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 500 }
      );
    }

    console.log(`[Mobile Daily Goals] Goal deleted successfully`);

    const response = NextResponse.json({
      success: true,
      data: { message: 'Goal deleted successfully' },
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

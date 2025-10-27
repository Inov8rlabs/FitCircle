/**
 * Daily Goal Management API
 *
 * PATCH /api/daily-goals/[id] - Update a specific daily goal
 * DELETE /api/daily-goals/[id] - Delete a daily goal
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase-server';
import { DailyGoalService } from '@/lib/services/daily-goals';

// Validation schema for PATCH
const updateGoalSchema = z.object({
  target_value: z.number().positive().optional(),
  is_primary: z.boolean().optional(),
}).refine(data => data.target_value !== undefined || data.is_primary !== undefined, {
  message: 'At least one field (target_value or is_primary) must be provided',
});

/**
 * PATCH /api/daily-goals/[id]
 * Update a daily goal (e.g., adjust target value)
 *
 * Body:
 * - target_value: New target value
 * - is_primary: Set as primary goal
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: goalId } = await params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(goalId)) {
      return NextResponse.json({ error: 'Invalid goal ID format' }, { status: 400 });
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = updateGoalSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid request data',
          details: validationResult.error.errors
        },
        { status: 400 }
      );
    }

    const { target_value, is_primary } = validationResult.data;

    // Set primary goal if requested
    if (is_primary === true) {
      const { success, error } = await DailyGoalService.setPrimaryGoal(goalId, user.id, supabase);
      if (!success || error) {
        return NextResponse.json({ error: error?.message || 'Failed to set primary goal' }, { status: 500 });
      }
    }

    // Adjust target value if provided
    if (target_value !== undefined) {
      const { success, error } = await DailyGoalService.adjustGoalTarget(
        goalId,
        user.id,
        target_value,
        supabase
      );
      if (!success || error) {
        return NextResponse.json({ error: error?.message || 'Failed to adjust goal' }, { status: 500 });
      }
    }

    // Fetch updated goal
    const { data: goal, error: fetchError } = await supabase
      .from('daily_goals')
      .select('*')
      .eq('id', goalId)
      .eq('user_id', user.id)
      .single();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    return NextResponse.json({ goal }, { status: 200 });
  } catch (error) {
    console.error('Error updating daily goal:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/daily-goals/[id]
 * Deactivate a daily goal (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: goalId } = await params;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(goalId)) {
      return NextResponse.json({ error: 'Invalid goal ID format' }, { status: 400 });
    }

    // Soft delete by setting is_active to false
    const { error } = await supabase
      .from('daily_goals')
      .update({ is_active: false })
      .eq('id', goalId)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Error deleting daily goal:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

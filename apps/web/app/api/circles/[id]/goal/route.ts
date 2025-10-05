import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';
import { z } from 'zod';

// Validation schema for setting a goal
const setGoalSchema = z.object({
  goal_type: z.enum(['weight_loss', 'step_count', 'workout_frequency', 'custom']),
  goal_start_value: z.number().optional(),
  goal_target_value: z.number(),
  goal_unit: z.string().optional(),
  goal_description: z.string().optional(),
});

// POST /api/circles/[id]/goal - Set personal goal
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is a member of the circle
    const members = await CircleService.getCircleMembers(params.id);
    const member = members.find(m => m.user_id === user.id);

    if (!member) {
      return NextResponse.json(
        { error: 'You must be a member of this circle to set a goal' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = setGoalSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          validation_errors: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          }))
        },
        { status: 400 }
      );
    }

    // Set the goal
    await CircleService.setPersonalGoal(user.id, params.id, validation.data);

    // Calculate initial progress
    const progress = validation.data.goal_start_value
      ? CircleService.calculateProgress(
          { ...member, ...validation.data } as any,
          validation.data.goal_start_value
        )
      : 0;

    return NextResponse.json({
      success: true,
      data: {
        goal_id: member.id,
        progress_percentage: progress,
        message: 'Goal set successfully'
      }
    });
  } catch (error: any) {
    console.error('Set goal error:', error);

    // Handle specific errors
    if (error.message?.includes('locked')) {
      return NextResponse.json(
        { error: 'Goal cannot be changed after the circle starts' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to set goal' },
      { status: 500 }
    );
  }
}

// PUT /api/circles/[id]/goal - Update goal (only before circle starts)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return POST(request, { params });
}
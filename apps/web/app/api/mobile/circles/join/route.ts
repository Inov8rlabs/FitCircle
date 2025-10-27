import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleService } from '@/lib/services/circle-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { DailyGoalService } from '@/lib/services/daily-goals';

// Validation schema
const joinCircleSchema = z.object({
  inviteCode: z.string().min(1, 'Invite code is required'),
  goal: z
    .object({
      goal_type: z.enum(['weight_loss', 'step_count', 'workout_frequency', 'custom']),
      goal_start_value: z.number().optional(),
      goal_target_value: z.number(),
      goal_unit: z.string(),
      goal_description: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /api/mobile/circles/join
 * Join a circle using an invite code
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = joinCircleSchema.parse(body);

    // Normalize invite code
    const inviteCode = validatedData.inviteCode.toUpperCase().trim();

    // Get invite details
    const inviteDetails = await CircleService.getInviteByCode(inviteCode);

    if (!inviteDetails.valid) {
      return NextResponse.json(
        {
          error: 'Invalid invite',
          message: inviteDetails.error_reason || 'Invalid invite code',
        },
        { status: 400 }
      );
    }

    // Find the circle
    const supabaseAdmin = createAdminSupabase();

    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('id, created_by, start_date')
      .eq('invite_code', inviteCode)
      .single();

    if (circleError || !circle) {
      return NextResponse.json(
        {
          error: 'Circle not found',
          message: 'Could not find circle with this invite code',
        },
        { status: 404 }
      );
    }

    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('challenge_participants')
      .select('id')
      .eq('challenge_id', circle.id)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      return NextResponse.json(
        {
          error: 'Already a member',
          message: 'You are already a member of this circle',
        },
        { status: 409 }
      );
    }

    // Join the circle
    if (validatedData.goal) {
      await CircleService.joinCircle(user.id, circle.id, inviteCode, validatedData.goal);
    } else {
      // Accept invite without goal (for now)
      await CircleService.acceptInvite(inviteCode, user.id);

      // Add as member without goal
      const { error: memberError } = await supabaseAdmin.from('challenge_participants').insert({
        challenge_id: circle.id,
        user_id: user.id,
        invited_by: circle.created_by,
        status: 'active',
      });

      if (memberError) throw memberError;

      // Update participant count
      const { data: currentCircle } = await supabaseAdmin
        .from('challenges')
        .select('participant_count')
        .eq('id', circle.id)
        .single();

      await supabaseAdmin
        .from('challenges')
        .update({
          participant_count: (currentCircle?.participant_count || 0) + 1,
        })
        .eq('id', circle.id);
    }

    // Create daily goals for the user based on the challenge
    try {
      await DailyGoalService.createDailyGoalsForChallenge(
        user.id,
        circle.id,
        supabaseAdmin
      );
    } catch (goalError) {
      // Log but don't fail the request if goal creation fails
      console.error('[Mobile API] Failed to create daily goals:', goalError);
    }

    // Get updated circle details
    const updatedCircle = await CircleService.getCircle(circle.id);

    return NextResponse.json(
      {
        success: true,
        circle: updatedCircle,
        message: 'Successfully joined the circle',
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Join circle error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: 'Invalid input data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

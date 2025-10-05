import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';
import { z } from 'zod';

// GET /api/circles/join/[code] - Get invite details
export async function GET(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    // Get invite details
    const inviteDetails = await CircleService.getInviteByCode(params.code);

    return NextResponse.json({
      success: true,
      data: inviteDetails
    });
  } catch (error: any) {
    console.error('Get invite details error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to validate invite code' },
      { status: 500 }
    );
  }
}

// Validation schema for joining a circle
const joinCircleSchema = z.object({
  goal_type: z.enum(['weight_loss', 'step_count', 'workout_frequency', 'custom']),
  goal_start_value: z.number().optional(),
  goal_target_value: z.number(),
  goal_unit: z.string().optional(),
  goal_description: z.string().optional(),
});

// POST /api/circles/join/[code] - Accept invite and join circle
export async function POST(
  request: NextRequest,
  { params }: { params: { code: string } }
) {
  try {
    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Please sign in to join the circle' },
        { status: 401 }
      );
    }

    // Validate invite code first
    const inviteDetails = await CircleService.getInviteByCode(params.code);

    if (!inviteDetails.valid) {
      return NextResponse.json(
        { error: inviteDetails.error_reason || 'Invalid invite code' },
        { status: 400 }
      );
    }

    // Parse and validate request body (goal data)
    const body = await request.json();
    const validation = joinCircleSchema.safeParse(body);

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

    // Get circle ID from invite code
    const supabaseAdmin = createServerSupabase();
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('id')
      .eq('invite_code', params.code.toUpperCase().trim())
      .single();

    if (circleError || !circle) {
      return NextResponse.json(
        { error: 'Circle not found' },
        { status: 404 }
      );
    }

    // Join the circle with goal
    await CircleService.joinCircle(
      user.id,
      circle.id,
      params.code,
      validation.data
    );

    // Return success with redirect URL
    return NextResponse.json({
      success: true,
      data: {
        circle_id: circle.id,
        redirect_url: `/circles/${circle.id}`,
        message: 'Successfully joined the circle!'
      }
    });
  } catch (error: any) {
    console.error('Join circle error:', error);

    // Handle specific errors
    if (error.message?.includes('already a member')) {
      return NextResponse.json(
        { error: 'You are already a member of this circle' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to join circle' },
      { status: 500 }
    );
  }
}
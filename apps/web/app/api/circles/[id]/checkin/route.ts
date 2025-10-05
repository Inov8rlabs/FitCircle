import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';
import { z } from 'zod';

// Validation schema for check-in
const checkInSchema = z.object({
  value: z.number(),
  mood_score: z.number().min(1).max(10).optional(),
  energy_level: z.number().min(1).max(10).optional(),
  note: z.string().max(100).optional(),
});

// POST /api/circles/[id]/checkin - Submit daily check-in
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
        { error: 'You must be a member of this circle to check in' },
        { status: 403 }
      );
    }

    // Check if user has set a goal
    if (!member.goal_type) {
      return NextResponse.json(
        { error: 'Please set your goal before checking in' },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = checkInSchema.safeParse(body);

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

    // Submit check-in
    const result = await CircleService.submitCheckIn(user.id, params.id, validation.data);

    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error: any) {
    console.error('Check-in error:', error);

    // Handle specific errors
    if (error.message?.includes('already checked in')) {
      return NextResponse.json(
        { error: 'You have already checked in today' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to submit check-in' },
      { status: 500 }
    );
  }
}
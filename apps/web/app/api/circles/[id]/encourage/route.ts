import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';
import { z } from 'zod';
import { MAX_HIGH_FIVES_PER_DAY } from '@/app/lib/types/circle';

// Validation schema for encouragement
const encouragementSchema = z.object({
  to_user_id: z.string().uuid().optional(),
  type: z.enum(['high_five', 'message', 'cheer', 'milestone']),
  content: z.string().max(200).optional(),
  milestone_type: z.enum([
    'progress_25', 'progress_50', 'progress_75', 'progress_100',
    'streak_7', 'streak_14', 'streak_30'
  ]).optional(),
});

// POST /api/circles/[id]/encourage - Send encouragement
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
    const isMember = members.some(m => m.user_id === user.id);

    if (!isMember) {
      return NextResponse.json(
        { error: 'You must be a member of this circle to send encouragement' },
        { status: 403 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = encouragementSchema.safeParse(body);

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

    // If sending to a specific user, verify they're also a member
    if (validation.data.to_user_id) {
      const targetIsMember = members.some(m => m.user_id === validation.data.to_user_id);
      if (!targetIsMember) {
        return NextResponse.json(
          { error: 'Target user is not a member of this circle' },
          { status: 400 }
        );
      }
    }

    // Send encouragement
    await CircleService.sendEncouragement(user.id, params.id, validation.data);

    // Calculate remaining high-fives if applicable
    let dailyLimitRemaining = MAX_HIGH_FIVES_PER_DAY;
    if (validation.data.type === 'high_five') {
      const today = new Date().toISOString().split('T')[0];
      const supabaseAdmin = createServerSupabase();

      const { data: limit } = await supabaseAdmin
        .from('daily_high_five_limits')
        .select('count')
        .eq('user_id', user.id)
        .eq('circle_id', params.id)
        .eq('date', today)
        .single();

      if (limit) {
        dailyLimitRemaining = Math.max(0, MAX_HIGH_FIVES_PER_DAY - limit.count);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        sent: true,
        daily_limit_remaining: dailyLimitRemaining,
        message: 'Encouragement sent!'
      }
    });
  } catch (error: any) {
    console.error('Send encouragement error:', error);

    // Handle specific errors
    if (error.message?.includes('daily limit')) {
      return NextResponse.json(
        { error: error.message },
        { status: 429 } // Too Many Requests
      );
    }

    return NextResponse.json(
      { error: error.message || 'Failed to send encouragement' },
      { status: 500 }
    );
  }
}
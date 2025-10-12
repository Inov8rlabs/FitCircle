import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: challengeId, userId } = await context.params;

    // Get the authenticated user
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUser = session.user;

    // Only allow users to edit their own goals
    if (currentUser.id !== userId) {
      return NextResponse.json({ error: 'Forbidden - can only edit your own goals' }, { status: 403 });
    }

    const body = await request.json();
    const { goal_start_value, goal_target_value, goal_type, goal_unit } = body;

    // Validate input
    if (goal_start_value !== undefined && (typeof goal_start_value !== 'number' || goal_start_value <= 0)) {
      return NextResponse.json({ error: 'Invalid starting value' }, { status: 400 });
    }

    if (goal_target_value !== undefined && (typeof goal_target_value !== 'number' || goal_target_value <= 0)) {
      return NextResponse.json({ error: 'Invalid goal value' }, { status: 400 });
    }

    // Prepare update data
    const updateData: any = {};
    if (goal_start_value !== undefined) {
      updateData.goal_start_value = goal_start_value;
      updateData.current_value = goal_start_value; // Initialize current_value
    }
    if (goal_target_value !== undefined) updateData.goal_target_value = goal_target_value;
    if (goal_type !== undefined) updateData.goal_type = goal_type;
    if (goal_unit !== undefined) updateData.goal_unit = goal_unit;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    console.log('Updating participant goals:', { challengeId, userId, updateData });

    // Update challenge_participants table
    const { data, error } = await supabase
      .from('challenge_participants')
      .update(updateData)
      .eq('challenge_id', challengeId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating participant goals:', error);
      return NextResponse.json({ error: 'Failed to update goals' }, { status: 500 });
    }

    console.log('Successfully updated participant goals');
    return NextResponse.json({
      success: true,
      data: {
        goal_start_value: data.goal_start_value,
        goal_target_value: data.goal_target_value,
        goal_type: data.goal_type,
        goal_unit: data.goal_unit,
        current_value: data.current_value,
      }
    });

  } catch (error) {
    console.error('Error in update goals API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

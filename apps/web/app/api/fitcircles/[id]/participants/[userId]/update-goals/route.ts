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
    const { starting_value, goal_value } = body;

    // Validate input
    if (starting_value !== undefined && (typeof starting_value !== 'number' || starting_value <= 0)) {
      return NextResponse.json({ error: 'Invalid starting value' }, { status: 400 });
    }

    if (goal_value !== undefined && (typeof goal_value !== 'number' || goal_value <= 0)) {
      return NextResponse.json({ error: 'Invalid goal value' }, { status: 400 });
    }

    // Prepare update data
    const updateData: any = {};
    if (starting_value !== undefined) updateData.starting_value = starting_value;
    if (goal_value !== undefined) updateData.goal_value = goal_value;

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
        starting_value: data.starting_value,
        goal_value: data.goal_value,
      }
    });

  } catch (error) {
    console.error('Error in update goals API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

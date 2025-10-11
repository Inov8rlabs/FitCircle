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

    // Only allow users to edit their own entries
    if (currentUser.id !== userId) {
      return NextResponse.json({ error: 'Forbidden - can only edit your own entries' }, { status: 403 });
    }

    const body = await request.json();
    const { tracking_date, value } = body;

    // Validate input
    if (!tracking_date) {
      return NextResponse.json({ error: 'Missing tracking_date' }, { status: 400 });
    }

    if (value === undefined || typeof value !== 'number' || value < 0) {
      return NextResponse.json({ error: 'Invalid value' }, { status: 400 });
    }

    // Get challenge details to know the type and valid date range
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('type, start_date, end_date')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // Validate date is within challenge period
    const entryDate = new Date(tracking_date);
    const startDate = new Date(challenge.start_date);
    const endDate = new Date(challenge.end_date);

    if (entryDate < startDate || entryDate > endDate) {
      return NextResponse.json({
        error: 'Entry date must be within challenge period'
      }, { status: 400 });
    }

    // Map challenge type to daily_tracking column
    const columnMap: Record<string, string> = {
      weight_loss: 'weight_kg',
      step_count: 'steps',
      workout_frequency: 'workout_minutes',
      custom: 'weight_kg',
    };

    const column = columnMap[challenge.type] || 'weight_kg';

    console.log('Updating daily entry:', { userId, tracking_date, column, value });

    // Update the entry in daily_tracking
    const updateData: any = {
      [column]: value,
    };

    const { data, error } = await supabase
      .from('daily_tracking')
      .update(updateData)
      .eq('user_id', userId)
      .eq('tracking_date', tracking_date)
      .select()
      .single();

    if (error) {
      console.error('Error updating daily entry:', error);
      return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
    }

    console.log('Successfully updated daily entry');
    return NextResponse.json({
      success: true,
      entry: {
        tracking_date,
        value,
      }
    });

  } catch (error) {
    console.error('Error in update entry API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
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

    // Only allow users to delete their own entries
    if (currentUser.id !== userId) {
      return NextResponse.json({ error: 'Forbidden - can only delete your own entries' }, { status: 403 });
    }

    const body = await request.json();
    const { tracking_date } = body;

    if (!tracking_date) {
      return NextResponse.json({ error: 'Missing tracking_date' }, { status: 400 });
    }

    // Get challenge details to know the type
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('type')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // Map challenge type to daily_tracking column
    const columnMap: Record<string, string> = {
      weight_loss: 'weight_kg',
      step_count: 'steps',
      workout_frequency: 'workout_minutes',
      custom: 'weight_kg',
    };

    const column = columnMap[challenge.type] || 'weight_kg';

    console.log('Deleting daily entry (setting to null):', { userId, tracking_date, column });

    // Set the column value to null instead of deleting the row
    // This preserves other data like mood_score, energy_level if present
    const updateData: any = {
      [column]: null,
    };

    const { error } = await supabase
      .from('daily_tracking')
      .update(updateData)
      .eq('user_id', userId)
      .eq('tracking_date', tracking_date);

    if (error) {
      console.error('Error deleting daily entry:', error);
      return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }

    console.log('Successfully deleted daily entry');
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error in delete entry API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

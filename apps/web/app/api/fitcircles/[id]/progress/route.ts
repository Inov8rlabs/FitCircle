import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: challengeId } = await context.params;

    // Get the authenticated user using cookies
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user;
    console.log('Fetching progress history for challenge:', challengeId, 'user:', user.id);

    // Get challenge details to know the date range and type
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('type, start_date, end_date')
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      console.error('Error fetching challenge:', challengeError);
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

    // Fetch user's entries from daily_tracking within the challenge period
    const { data: entriesData, error: entriesError } = await supabase
      .from('daily_tracking')
      .select(`tracking_date, ${column}`)
      .eq('user_id', user.id)
      .gte('tracking_date', challenge.start_date)
      .lte('tracking_date', challenge.end_date)
      .not(column, 'is', null)
      .order('tracking_date', { ascending: false })
      .limit(10);

    if (entriesError) {
      console.error('Error fetching progress entries:', entriesError);
      return NextResponse.json({ error: 'Failed to fetch progress entries' }, { status: 500 });
    }

    // Transform to match expected format
    const entries = (entriesData || []).map((entry: any) => ({
      date: entry.tracking_date,
      value: entry[column],
      is_public: true, // TODO: Add privacy settings
    }));

    console.log('Found progress entries:', entries.length);
    return NextResponse.json({ entries });

  } catch (error) {
    console.error('Error in progress API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: challengeId } = await context.params;

    // Get the authenticated user using cookies
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user;

    const body = await request.json();
    const { value, is_public } = body;

    if (!value || typeof value !== 'number' || value < 0) {
      return NextResponse.json({ error: 'Invalid value' }, { status: 400 });
    }

    console.log('Submitting progress entry:', { challengeId, userId: user.id, value, is_public });

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
    const today = new Date().toISOString().split('T')[0];

    // Upsert to daily_tracking (update if exists, insert if not)
    const updateData: any = {
      user_id: user.id,
      tracking_date: today,
      [column]: value,
    };

    const { data: newEntry, error: upsertError } = (await supabase
      .from('daily_tracking')
      .upsert(updateData, {
        onConflict: 'user_id,tracking_date',
      })
      .select()
      .single()) as any;

    if (upsertError) {
      console.error('Error upserting progress entry:', upsertError);
      return NextResponse.json({ error: 'Failed to submit entry' }, { status: 500 });
    }

    console.log('Progress entry submitted successfully to daily_tracking');
    return NextResponse.json({
      entry: {
        date: today,
        value: value,
        is_public: true,
      },
      success: true
    });

  } catch (error) {
    console.error('Error in progress POST API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

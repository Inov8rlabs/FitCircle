import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const resolvedParams = await context.params;
    const challengeId = resolvedParams.id;
    const userId = resolvedParams.userId;

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get challenge details to know date range and type
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
      .select('type, start_date, end_date')
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

    console.log('Fetching progress entries:', {
      userId,
      challengeId,
      challengeType: challenge.type,
      column,
      startDate: challenge.start_date,
      endDate: challenge.end_date
    });

    // Fetch tracking entries for this user within challenge period
    const { data: entries, error: entriesError } = await supabase
      .from('daily_tracking')
      .select(`tracking_date, ${column}`)
      .eq('user_id', userId)
      .gte('tracking_date', challenge.start_date)
      .lte('tracking_date', challenge.end_date)
      .not(column, 'is', null)
      .order('tracking_date', { ascending: false });

    console.log('Entries result:', {
      count: entries?.length || 0,
      error: entriesError,
      firstEntry: entries?.[0]
    });

    if (entriesError) {
      console.error('Error fetching entries:', entriesError);
      return NextResponse.json({
        error: 'Failed to fetch entries',
        details: entriesError.message
      }, { status: 500 });
    }

    // Transform entries to match expected format
    // Note: daily_tracking doesn't have is_public column, all entries are public for now
    const progressEntries = (entries || []).map((entry: any) => ({
      tracking_date: entry.tracking_date,
      value: entry[column],
      is_public: true, // TODO: Add privacy settings for daily tracking
    }));

    return NextResponse.json({
      entries: progressEntries,
      total: progressEntries.length,
    });

  } catch (error) {
    console.error('Error in progress API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

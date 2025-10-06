import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerSupabase();
    const challengeId = params.id;

    // Get the authenticated user using cookies
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user;
    console.log('Fetching progress history for challenge:', challengeId, 'user:', user.id);

    // Get progress entries with privacy filtering
    // User's own entries OR public entries from other users in the challenge
    const { data: entriesData, error: entriesError } = await supabase
      .from('progress_entries')
      .select('*')
      .eq('challenge_id', challengeId)
      .or(`user_id.eq.${user.id},is_public.eq.true`)
      .order('date', { ascending: false });

    if (entriesError) {
      console.error('Error fetching progress entries:', entriesError);
      return NextResponse.json({ error: 'Failed to fetch progress entries' }, { status: 500 });
    }

    console.log('Found progress entries:', entriesData?.length || 0);
    return NextResponse.json({ entries: entriesData || [] });

  } catch (error) {
    console.error('Error in progress API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createServerSupabase();
    const challengeId = params.id;

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

    // Check if user already submitted today
    const today = new Date().toISOString().split('T')[0];
    const { data: existingEntry } = await supabase
      .from('progress_entries')
      .select('id')
      .eq('challenge_id', challengeId)
      .eq('user_id', user.id)
      .eq('date', today)
      .single();

    if (existingEntry) {
      return NextResponse.json({ error: 'Entry already submitted for today' }, { status: 409 });
    }

    // Insert the progress entry
    const { data: newEntry, error: insertError } = await supabase
      .from('progress_entries')
      .insert({
        user_id: user.id,
        challenge_id: challengeId,
        value: value,
        is_public: is_public || false,
        date: today,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting progress entry:', insertError);
      return NextResponse.json({ error: 'Failed to submit entry' }, { status: 500 });
    }

    console.log('Progress entry submitted successfully:', newEntry.id);
    return NextResponse.json({ entry: newEntry, success: true });

  } catch (error) {
    console.error('Error in progress POST API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

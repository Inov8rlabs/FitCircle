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

    console.log('Fetching participants for challenge:', challengeId);

    // Get challenge details first
    const { data: challenge } = await supabase
      .from('challenges')
      .select('creator_id')
      .eq('id', challengeId)
      .single();

    // Get active participants with profile data
    const { data: participantsData, error: participantsError } = await supabase
      .from('challenge_participants')
      .select(`
        id,
        user_id,
        challenge_id,
        status,
        joined_at
      `)
      .eq('challenge_id', challengeId)
      .eq('status', 'active');

    if (participantsError) {
      console.error('Error fetching participants:', participantsError);
      return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 });
    }

    if (!participantsData) {
      return NextResponse.json({ participants: [] });
    }

    console.log('Found participants:', participantsData.length);

    // Get progress data for each participant
    const participantsWithProgress = await Promise.all(
      participantsData.map(async (participant) => {
        try {
          // Get latest progress entry for this participant
          const { data: latestEntry } = await supabase
            .from('progress_entries')
            .select('value, date, is_public')
            .eq('challenge_id', challengeId)
            .eq('user_id', participant.user_id)
            .order('date', { ascending: false })
            .limit(1)
            .single();

          // Get total entries for this participant
          const { count: totalEntries } = await supabase
            .from('progress_entries')
            .select('*', { count: 'exact', head: true })
            .eq('challenge_id', challengeId)
            .eq('user_id', participant.user_id);

          return {
            ...participant,
            display_name: 'Unknown User', // Will be updated when we get user data
            avatar_url: '',
            latest_value: latestEntry?.value || 0,
            latest_date: latestEntry?.date || new Date().toISOString().split('T')[0],
            total_entries: totalEntries || 0,
            is_public: latestEntry?.is_public || false,
            is_creator: participant.user_id === challenge?.creator_id,
            is_current_user: participant.user_id === user.id,
            progress_percentage: latestEntry?.value ? Math.min(100, (latestEntry.value / 100) * 100) : 0,
          };
        } catch (err) {
          console.error('Error processing participant:', participant.user_id, err);
          return {
            ...participant,
            display_name: 'Unknown User',
            avatar_url: '',
            latest_value: 0,
            latest_date: new Date().toISOString().split('T')[0],
            total_entries: 0,
            is_public: false,
            is_creator: participant.user_id === challenge?.creator_id,
            is_current_user: participant.user_id === user.id,
            progress_percentage: 0,
          };
        }
      })
    );

    // Sort by progress (highest first)
    participantsWithProgress.sort((a, b) => b.progress_percentage - a.progress_percentage);

    console.log('Returning participants:', participantsWithProgress.length);
    return NextResponse.json({ participants: participantsWithProgress });

  } catch (error) {
    console.error('Error in participants API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('Fetching circles for user:', user.id);

    // Get challenges where user is creator
    const { data: creatorChallenges, error: creatorError } = await supabase
      .from('challenges')
      .select(`
        id,
        name,
        description,
        type,
        start_date,
        end_date,
        creator_id,
        invite_code,
        visibility,
        max_participants,
        created_at
      `)
      .eq('creator_id', user.id);

    // Get challenges where user is a participant
    // We need to query from challenge_participants and join to challenges
    const { data: participantData, error: participantError } = await supabase
      .from('challenge_participants')
      .select(`
        challenge_id,
        challenges!inner (
          id,
          name,
          description,
          type,
          start_date,
          end_date,
          creator_id,
          invite_code,
          visibility,
          max_participants,
          created_at
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (creatorError) {
      console.error('Error fetching creator challenges:', creatorError);
      return NextResponse.json({ error: 'Failed to fetch creator challenges' }, { status: 500 });
    }

    if (participantError) {
      console.error('Error fetching participant challenges:', participantError);
      return NextResponse.json({ error: 'Failed to fetch participant challenges' }, { status: 500 });
    }

    // Extract the challenges from the participant data
    const participantChallenges = participantData?.map((p: any) => p.challenges).filter(Boolean) || [];

    console.log('Found challenges:', {
      creator: creatorChallenges?.length || 0,
      participant: participantChallenges.length || 0
    });

    // Combine and deduplicate challenges
    const allChallenges = [
      ...(creatorChallenges || []),
      ...(participantChallenges || [])
    ];

    // Remove duplicates (challenges where user is both creator and participant)
    const uniqueChallenges = allChallenges.filter((challenge, index, self) =>
      index === self.findIndex(c => c.id === challenge.id)
    );

    // Get participant counts and user progress for each challenge
    const circlesWithProgress = await Promise.all(
      uniqueChallenges.map(async (challenge) => {
        try {
          // Get participant count
          const { count: participantCount } = await supabase
            .from('challenge_participants')
            .select('*', { count: 'exact', head: true })
            .eq('challenge_id', challenge.id)
            .eq('status', 'active');

          // Get user's latest progress for this challenge
          const { data: userProgress } = await supabase
            .from('progress_entries')
            .select('value')
            .eq('challenge_id', challenge.id)
            .eq('user_id', user.id)
            .order('date', { ascending: false })
            .limit(1)
            .single();

          // Get user's total entries for this challenge
          const { count: totalEntries } = await supabase
            .from('progress_entries')
            .select('*', { count: 'exact', head: true })
            .eq('challenge_id', challenge.id)
            .eq('user_id', user.id);

          return {
            ...challenge,
            participant_count: participantCount || 0,
            is_creator: challenge.creator_id === user.id,
            is_participant: true, // Since we filtered by this
            latest_progress: userProgress?.value || 0,
            total_entries: totalEntries || 0,
          };
        } catch (err) {
          console.error('Error processing challenge:', challenge.id, err);
          return {
            ...challenge,
            participant_count: 0,
            is_creator: challenge.creator_id === user.id,
            is_participant: true,
            latest_progress: 0,
            total_entries: 0,
          };
        }
      })
    );

    console.log('Returning circles:', circlesWithProgress.length);
    return NextResponse.json({ circles: circlesWithProgress });

  } catch (error) {
    console.error('Error in fitcircles API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

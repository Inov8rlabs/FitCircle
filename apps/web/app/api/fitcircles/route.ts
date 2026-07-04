import { type NextRequest, NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase-server';
import { createAdminSupabase } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    // Authorize the caller with the RLS-bound (cookie) client...
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ...then read data with the service-role client. Under migration 069 the
    // browser/anon RLS on fitcircles is "public OR creator" and fitcircle_members
    // is own-row, so cross-user reads (participant counts, private joined circles)
    // MUST run service-role. All reads below are still scoped to THIS user's
    // circles (creator_id = user.id, or member user_id = user.id), so the admin
    // client does not widen what the caller can see.
    const db = createAdminSupabase();

    // Circles where the user is the creator
    const { data: creatorChallenges, error: creatorError } = await db
      .from('fitcircles')
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

    // Circles where the user is an active member (incl. private circles they joined)
    const { data: participantData, error: participantError } = await db
      .from('fitcircle_members')
      .select(`
        fitcircle_id,
        fitcircles!inner (
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

    const participantChallenges = participantData?.map((p: any) => p.fitcircles).filter(Boolean) || [];

    const allChallenges = [
      ...(creatorChallenges || []),
      ...(participantChallenges || []),
    ];

    // Deduplicate (creator + participant of the same circle)
    const uniqueChallenges = allChallenges.filter((challenge, index, self) =>
      index === self.findIndex((c) => c.id === challenge.id)
    );

    // Participant counts + this user's progress per circle (service-role reads)
    const circlesWithProgress = await Promise.all(
      uniqueChallenges.map(async (challenge) => {
        try {
          const { count: participantCount } = await db
            .from('fitcircle_members')
            .select('*', { count: 'exact', head: true })
            .eq('fitcircle_id', challenge.id)
            .eq('status', 'active');

          const { data: userProgress } = await db
            .from('progress_entries')
            .select('value')
            .eq('challenge_id', challenge.id)
            .eq('user_id', user.id)
            .order('date', { ascending: false })
            .limit(1)
            .single();

          const { count: totalEntries } = await db
            .from('progress_entries')
            .select('*', { count: 'exact', head: true })
            .eq('challenge_id', challenge.id)
            .eq('user_id', user.id);

          return {
            ...challenge,
            participant_count: participantCount || 0,
            is_creator: challenge.creator_id === user.id,
            is_participant: true,
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

    return NextResponse.json({ circles: circlesWithProgress });
  } catch (error) {
    console.error('Error in fitcircles API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

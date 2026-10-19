import { type NextRequest, NextResponse } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: challengeId } = await context.params;

    // Authorize the caller.
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Service-role reads: fitcircle_members is own-row under migration 069, so the
    // roster must be read service-role. Gate it: only the creator or an active
    // member may view the full participant list.
    const db = createAdminSupabase();

    const { data: challenge } = await db
      .from('fitcircles')
      .select('creator_id, visibility')
      .eq('id', challengeId)
      .single();

    if (!challenge) {
      return NextResponse.json({ error: 'FitCircle not found' }, { status: 404 });
    }

    const isCreator = challenge.creator_id === user.id;
    const { data: callerMembership } = await db
      .from('fitcircle_members')
      .select('id')
      .eq('fitcircle_id', challengeId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (!isCreator && !callerMembership) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: participantsData, error: participantsError } = await db
      .from('fitcircle_members')
      .select('id, user_id, challenge_id, status, joined_at')
      .eq('fitcircle_id', challengeId)
      .eq('status', 'active');

    if (participantsError) {
      console.error('Error fetching participants:', participantsError);
      return NextResponse.json({ error: 'Failed to fetch participants' }, { status: 500 });
    }

    if (!participantsData || participantsData.length === 0) {
      return NextResponse.json({ participants: [] });
    }

    // Resolve display names/avatars from profiles (service-role).
    const userIds = participantsData.map((p) => p.user_id);
    const { data: profiles } = await db
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .in('id', userIds);
    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));

    const participantsWithProgress = await Promise.all(
      participantsData.map(async (participant) => {
        const profile = profileById.get(participant.user_id);
        try {
          const { data: latestEntry } = await db
            .from('progress_entries')
            .select('value, date, is_public')
            .eq('challenge_id', challengeId)
            .eq('user_id', participant.user_id)
            .order('date', { ascending: false })
            .limit(1)
            .single();

          const { count: totalEntries } = await db
            .from('progress_entries')
            .select('*', { count: 'exact', head: true })
            .eq('challenge_id', challengeId)
            .eq('user_id', participant.user_id);

          return {
            ...participant,
            display_name: profile?.display_name || profile?.username || 'Member',
            avatar_url: profile?.avatar_url || '',
            latest_value: latestEntry?.value || 0,
            latest_date: latestEntry?.date || new Date().toISOString().split('T')[0],
            total_entries: totalEntries || 0,
            is_public: latestEntry?.is_public || false,
            is_creator: participant.user_id === challenge.creator_id,
            is_current_user: participant.user_id === user.id,
            progress_percentage: latestEntry?.value ? Math.min(100, (latestEntry.value / 100) * 100) : 0,
          };
        } catch (err) {
          console.error('Error processing participant:', participant.user_id, err);
          return {
            ...participant,
            display_name: profile?.display_name || profile?.username || 'Member',
            avatar_url: profile?.avatar_url || '',
            latest_value: 0,
            latest_date: new Date().toISOString().split('T')[0],
            total_entries: 0,
            is_public: false,
            is_creator: participant.user_id === challenge.creator_id,
            is_current_user: participant.user_id === user.id,
            progress_percentage: 0,
          };
        }
      })
    );

    participantsWithProgress.sort((a, b) => b.progress_percentage - a.progress_percentage);

    return NextResponse.json({ participants: participantsWithProgress });
  } catch (error) {
    console.error('Error in participants API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

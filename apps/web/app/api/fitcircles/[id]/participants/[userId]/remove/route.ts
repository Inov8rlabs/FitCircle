import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: challengeId, userId: participantId } = await context.params;

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the challenge to verify ownership
    const { data: challenge, error: fetchError } = await supabase
      .from('challenges')
      .select('creator_id')
      .eq('id', challengeId)
      .single();

    if (fetchError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // Only creator can remove participants
    if (challenge.creator_id !== user.id) {
      return NextResponse.json({ error: 'Only the creator can remove participants' }, { status: 403 });
    }

    // Cannot remove the creator
    if (participantId === challenge.creator_id) {
      return NextResponse.json({ error: 'Cannot remove the creator' }, { status: 400 });
    }

    // Update participant status to 'removed'
    const { error: updateError } = await supabase
      .from('challenge_participants')
      .update({ status: 'removed' })
      .eq('challenge_id', challengeId)
      .eq('user_id', participantId);

    if (updateError) {
      console.error('Error removing participant:', updateError);
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in remove participant API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

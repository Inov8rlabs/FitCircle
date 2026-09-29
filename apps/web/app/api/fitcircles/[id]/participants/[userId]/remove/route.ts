import { type NextRequest, NextResponse } from 'next/server';

import { CircleService } from '@/lib/services/circle-service';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * POST /api/fitcircles/[id]/participants/[userId]/remove (cookie auth, web).
 *
 * The rules live in CircleService.removeParticipant, shared with the mobile
 * route DELETE /api/mobile/circles/[id]/participants/[userId]. Status codes and
 * bodies are the ones this route always returned.
 */
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

    let result;
    try {
      // As before: the circle is read through the cookie (RLS) client, and
      // removing someone who is not (or no longer) in the circle answers success.
      result = await CircleService.removeParticipant(user.id, challengeId, participantId, {
        requireMembership: false,
        circleClient: supabase,
      });
    } catch (removeError) {
      console.error('Error removing participant:', removeError);
      return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
    }

    if (!result.ok) {
      switch (result.reason) {
        case 'CIRCLE_NOT_FOUND':
          return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
        case 'NOT_CREATOR':
          return NextResponse.json({ error: 'Only the creator can remove participants' }, { status: 403 });
        case 'CANNOT_REMOVE_CREATOR':
        case 'CANNOT_REMOVE_SELF':
          return NextResponse.json({ error: 'Cannot remove the creator' }, { status: 400 });
        case 'NOT_A_MEMBER':
          return NextResponse.json({ error: 'Failed to remove participant' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, message: 'Participant removed successfully' });
  } catch (error) {
    console.error('Error in remove participant API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

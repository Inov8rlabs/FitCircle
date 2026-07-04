import { type NextRequest, NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase-server';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/fitcircles/[id] — single circle detail.
 *
 * Service-role route added for migration 069: under own-row RLS the browser can
 * no longer read a private circle it belongs to, nor another user's circle, so
 * detail must be served here with an explicit authorization gate:
 *   - PUBLIC circles: any authenticated user may view (preview).
 *   - PRIVATE / invite_only circles: only the creator or an active member.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Authorize the caller (cookie/RLS client is only used to identify them).
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = createAdminSupabase();

    const { data: circle, error: circleError } = await db
      .from('fitcircles')
      .select(`
        id,
        name,
        description,
        type,
        status,
        start_date,
        end_date,
        creator_id,
        invite_code,
        visibility,
        max_participants,
        created_at
      `)
      .eq('id', id)
      .single();

    if (circleError || !circle) {
      return NextResponse.json({ error: 'FitCircle not found' }, { status: 404 });
    }

    // Is the caller an active member?
    const { data: membership } = await db
      .from('fitcircle_members')
      .select('id')
      .eq('fitcircle_id', id)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    const isCreator = circle.creator_id === user.id;
    const isParticipant = Boolean(membership);

    // Authorization: private circles are visible only to the creator or members.
    if (circle.visibility !== 'public' && !isCreator && !isParticipant) {
      return NextResponse.json({ error: 'FitCircle not found' }, { status: 404 });
    }

    const { count: participantCount } = await db
      .from('fitcircle_members')
      .select('*', { count: 'exact', head: true })
      .eq('fitcircle_id', id)
      .eq('status', 'active');

    // Do not leak the invite_code to non-creators.
    const { invite_code, ...publicCircle } = circle as any;

    return NextResponse.json({
      circle: {
        ...publicCircle,
        ...(isCreator ? { invite_code } : {}),
        participant_count: participantCount || 0,
        is_creator: isCreator,
        is_participant: isParticipant,
      },
    });
  } catch (error) {
    console.error('Error in fitcircle detail API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

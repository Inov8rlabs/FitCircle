import { type NextRequest, NextResponse } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/fitcircles/validate?code=...
 *
 * Public invite preview. Looks up a FitCircle by its invite code and returns a
 * small, non-sensitive preview payload used by the join-by-code UIs.
 *
 * This route intentionally does NOT require a session — anyone with a valid
 * invite code (authenticated or anonymous) may preview the circle. It only
 * reads non-sensitive preview fields via the service-role admin client and
 * NEVER returns the invite_code itself.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawCode = searchParams.get('code');

    if (!rawCode || !rawCode.trim()) {
      return NextResponse.json(
        { error: 'Invite code is required' },
        { status: 400 }
      );
    }

    const code = rawCode.trim();

    const supabaseAdmin = createAdminSupabase();

    // Case-insensitive, trimmed lookup by invite code (ilike with no wildcards
    // performs a case-insensitive exact match).
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('fitcircles')
      .select(`
        id,
        name,
        description,
        type,
        status,
        start_date,
        end_date,
        max_participants,
        creator_id,
        profiles:creator_id (
          display_name,
          avatar_url
        )
      `)
      .ilike('invite_code', code)
      .single();

    if (circleError || !circle) {
      return NextResponse.json(
        { error: 'Invalid or expired invite code' },
        { status: 404 }
      );
    }

    const circleInfo = circle as any;

    // Active participant count via service-role (cross-user read).
    const { count: participantCount } = await supabaseAdmin
      .from('fitcircle_members')
      .select('id', { count: 'exact', head: true })
      .eq('fitcircle_id', circleInfo.id)
      .eq('status', 'active');

    return NextResponse.json({
      id: circleInfo.id,
      name: circleInfo.name,
      description: circleInfo.description || '',
      type: circleInfo.type,
      status: circleInfo.status,
      start_date: circleInfo.start_date,
      end_date: circleInfo.end_date,
      max_participants: circleInfo.max_participants ?? null,
      participant_count: participantCount || 0,
      creator: {
        display_name: circleInfo.profiles?.display_name || 'Circle Creator',
        avatar_url: circleInfo.profiles?.avatar_url ?? null,
      },
    });
  } catch (error) {
    console.error('[FitCircles API] Validate invite code error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}

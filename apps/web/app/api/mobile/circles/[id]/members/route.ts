import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/circles/[id]/members
 * Get list of circle members with basic info
 *
 * Returns: Array of members with display names, avatars, join dates
 * Privacy: Does NOT include goal details (privacy protection)
 *
 * Response fields per member:
 * - user_id: UUID
 * - display_name: string
 * - avatar_url: string | null
 * - joined_at: ISO timestamp
 * - is_creator: boolean
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;

    const supabaseAdmin = createAdminSupabase();

    // Verify user is a member of this circle
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('challenge_participants')
      .select('id')
      .eq('challenge_id', circleId)
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    if (membershipError && membershipError.code !== 'PGRST116') {
      throw membershipError;
    }

    if (!membership) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You must be a member of this circle to view members',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Get circle creator_id
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('creator_id')
      .eq('id', circleId)
      .single();

    if (circleError) {
      throw circleError;
    }

    // Get all active members with profile info
    const { data: members, error } = await supabaseAdmin
      .from('challenge_participants')
      .select(`
        user_id,
        joined_at,
        profiles!challenge_participants_user_id_fkey (
          display_name,
          avatar_url
        )
      `)
      .eq('challenge_id', circleId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true });

    if (error) {
      throw error;
    }

    // Transform data to privacy-safe format
    const membersData = (members || []).map((member: any) => ({
      user_id: member.user_id,
      display_name: member.profiles?.display_name || 'Unknown User',
      avatar_url: member.profiles?.avatar_url || null,
      joined_at: member.joined_at,
      is_creator: member.user_id === circle.creator_id,
    }));

    let response = NextResponse.json({
      success: true,
      data: {
        members: membersData,
        total_count: membersData.length,
      },
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Get circle members error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

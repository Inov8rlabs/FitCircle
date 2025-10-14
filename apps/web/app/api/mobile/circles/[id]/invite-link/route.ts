import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/circles/[id]/invite-link
 * Get invite code and link for a circle
 *
 * Permissions: Any member of the circle
 *
 * Response:
 * - invite_code: string (e.g., "ABC123XYZ")
 * - invite_url: string (e.g., "fitcircle://join?code=ABC123XYZ")
 * - expires_at: string | null (invite codes don't expire, but included for future)
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
            message: 'You must be a member of this circle to get invite links',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Get circle's invite code
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('invite_code, name')
      .eq('id', circleId)
      .single();

    if (circleError) {
      throw circleError;
    }

    if (!circle || !circle.invite_code) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Circle or invite code not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Generate invite URL for iOS deep linking
    const inviteUrl = `fitcircle://join?code=${circle.invite_code}`;

    const response = NextResponse.json({
      success: true,
      data: {
        invite_code: circle.invite_code,
        invite_url: inviteUrl,
        expires_at: null, // Invite codes don't expire currently
        circle_name: circle.name,
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Get invite link error:', error);

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

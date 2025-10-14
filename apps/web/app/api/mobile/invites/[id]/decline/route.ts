import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * POST /api/mobile/invites/[id]/decline
 * Decline a circle invite
 *
 * Sets invite status to 'expired' (declined invites are treated as expired)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: inviteId } = await params;

    const supabaseAdmin = createAdminSupabase();

    // Get user's email
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    const userEmail = profile?.email || user.email;

    // Get invite to verify it belongs to this user
    const { data: invite, error: fetchError } = await supabaseAdmin
      .from('circle_invites')
      .select('id, email, status')
      .eq('id', inviteId)
      .single();

    if (fetchError) {
      if (fetchError.code === 'PGRST116') {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'NOT_FOUND',
              message: 'Invite not found',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 404 }
        );
      }
      throw fetchError;
    }

    // Check if invite was for this user (or is open invite)
    if (invite.email && invite.email !== userEmail) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'This invite is not for you',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Check if already declined or accepted
    if (invite.status !== 'pending') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invite has already been ${invite.status}`,
            details: { current_status: invite.status },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Mark invite as expired (declined)
    const { error: updateError } = await supabaseAdmin
      .from('circle_invites')
      .update({
        status: 'expired',
        updated_at: new Date().toISOString(),
      })
      .eq('id', inviteId);

    if (updateError) {
      throw updateError;
    }

    console.log(`[Decline Invite] User ${user.id} declined invite ${inviteId}`);

    let response = NextResponse.json({
      success: true,
      data: {
        message: 'Invite declined successfully',
        invite_id: inviteId,
      },
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Decline invite error:', error);

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

import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/invites/pending
 * Get all pending invites for the authenticated user
 *
 * Filters:
 * - status = 'pending'
 * - email matches user's email (if invite was sent via email)
 * - OR invite code can be used by anyone
 *
 * Response: Array of invites with circle details
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabaseAdmin = createAdminSupabase();

    // Get user's email from profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    const userEmail = profile?.email || user.email;

    // Get pending invites for this user's email
    const { data: invites, error } = await supabaseAdmin
      .from('circle_invites')
      .select(`
        id,
        circle_id,
        invite_code,
        email,
        created_at,
        expires_at,
        challenges!circle_invites_circle_id_fkey (
          id,
          name,
          description,
          start_date,
          end_date,
          participant_count,
          status
        )
      `)
      .eq('status', 'pending')
      .or(`email.eq.${userEmail},email.is.null`)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Filter out expired invites and format response
    const now = new Date();
    const validInvites = (invites || [])
      .filter((invite) => {
        if (!invite.expires_at) return true;
        return new Date(invite.expires_at) > now;
      })
      .map((invite) => ({
        invite_id: invite.id,
        circle_id: invite.circle_id,
        invite_code: invite.invite_code,
        circle_name: (invite.challenges as any)?.name,
        circle_description: (invite.challenges as any)?.description,
        start_date: (invite.challenges as any)?.start_date,
        end_date: (invite.challenges as any)?.end_date,
        member_count: (invite.challenges as any)?.participant_count || 0,
        created_at: invite.created_at,
        expires_at: invite.expires_at,
      }));

    const response = NextResponse.json({
      success: true,
      data: {
        invites: validInvites,
        total_count: validInvites.length,
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Get pending invites error:', error);

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

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { circleInviteUrl, circleShareMessage } from '@/lib/referrals/links';
import { ReferralService } from '@/lib/services/referral-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/circles/[id]/invite-link
 * Get invite code and link for a circle
 *
 * Permissions: Any member of the circle
 *
 * Response:
 * - invite_code: string (e.g., "ABC123XYZ")
 * - invite_url: string (e.g., "https://www.fitcircle.ai/join/FITABC123?ref=MAYA7K2")
 * - referral_code / share_message: the sharer's referral code + prefilled share text
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
      .from('fitcircle_members')
      .select('id')
      .eq('fitcircle_id', circleId)
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
      .from('fitcircles')
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

    // https universal/app link carrying the sharer's referral code, so the
    // join is attributed to THIS member (not just the circle creator) and
    // fresh installs land on the web invite page with store links.
    // docs/REFERRALS_SPEC.md §3. (Was fitcircle://join?code=…, which no app handled.)
    // Never let referral bookkeeping break sharing: fall back to a plain link.
    const share = await ReferralService.circleShare(user.id, circle).catch((err) => {
      console.error('[invite-link] referral share fallback:', err?.message);
      const url = circleInviteUrl(circle.invite_code);
      return { referralCode: null, url, message: circleShareMessage(circle.name, url) };
    });

    const response = NextResponse.json({
      success: true,
      data: {
        invite_code: circle.invite_code,
        invite_url: share.url,
        expires_at: null, // Invite codes don't expire currently
        circle_name: circle.name,
        referral_code: share.referralCode,
        share_message: share.message,
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

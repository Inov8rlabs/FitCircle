import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * POST /api/mobile/circles/[id]/leave
 * Leave a circle (members only, not creator)
 *
 * Permissions: Any member except creator
 * Actions:
 * - Sets left_at timestamp on challenge_participants
 * - Decrements participant_count on challenges table
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;

    const supabaseAdmin = createAdminSupabase();

    // Get circle to check if user is creator
    const { data: circle, error: circleError } = await supabaseAdmin
      .from('challenges')
      .select('creator_id, participant_count')
      .eq('id', circleId)
      .single();

    if (circleError) {
      throw circleError;
    }

    if (!circle) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Circle not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    // Check if user is creator (creators cannot leave their own circle)
    if (circle.creator_id === user.id) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Circle creators cannot leave their own circle. Delete the circle instead.',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Get member record
    const { data: member, error: memberError } = await supabaseAdmin
      .from('challenge_participants')
      .select('id, status, left_at')
      .eq('challenge_id', circleId)
      .eq('user_id', user.id)
      .single();

    if (memberError) {
      if (memberError.code === 'PGRST116') {
        // Not found
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'NOT_FOUND',
              message: 'You are not a member of this circle',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 404 }
        );
      }
      throw memberError;
    }

    // Check if already left
    if (member.left_at) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'You have already left this circle',
            details: { left_at: member.left_at },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Mark member as left
    const { error: updateError } = await supabaseAdmin
      .from('challenge_participants')
      .update({
        left_at: new Date().toISOString(),
        status: 'left',
        updated_at: new Date().toISOString(),
      })
      .eq('id', member.id);

    if (updateError) {
      throw updateError;
    }

    // Decrement participant count
    const newCount = Math.max((circle.participant_count || 1) - 1, 0);
    const { error: countError } = await supabaseAdmin
      .from('challenges')
      .update({
        participant_count: newCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', circleId);

    if (countError) {
      console.error('[Leave Circle] Failed to update participant count:', countError);
      // Don't fail the request, member is already marked as left
    }

    console.log(`[Leave Circle] User ${user.id} left circle ${circleId}`);

    let response = NextResponse.json({
      success: true,
      data: {
        message: 'Successfully left the circle',
        left_at: new Date().toISOString(),
        circle_id: circleId,
      },
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Leave circle error:', error);

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

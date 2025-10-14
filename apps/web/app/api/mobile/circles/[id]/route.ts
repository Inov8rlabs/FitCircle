import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleService } from '@/lib/services/circle-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { z } from 'zod';

/**
 * Validation schema for circle updates
 */
const updateCircleSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  description: z.string().max(500).optional(),
  end_date: z.string().datetime().optional(),
});

/**
 * GET /api/mobile/circles/[id]
 * Get detailed information about a specific circle
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id: circleId } = await params;

    // Get circle details
    const circle = await CircleService.getCircle(circleId);

    // Get members
    const members = await CircleService.getCircleMembers(circleId);

    // Get leaderboard
    const leaderboard = await CircleService.getLeaderboard(circleId);

    // Get user's progress if they're a member
    const userMember = members.find((m) => m.user_id === user.id);

    const userProgress = userMember
      ? {
          progress_percentage: userMember.progress_percentage,
          current_value: userMember.current_value,
          goal_target_value: userMember.goal_target_value,
          streak_days: userMember.streak_days,
          check_ins_count: userMember.check_ins_count,
        }
      : null;

    // Get circle stats
    const stats = await CircleService.getCircleStats(circleId);

    let response = NextResponse.json({
      success: true,
      data: {
        ...circle,
        participants: members.map((m) => ({
          user_id: m.user_id,
          progress_percentage: m.progress_percentage,
          streak_days: m.streak_days,
          joined_at: m.joined_at,
        })),
        leaderboard,
        userProgress,
        stats,
      },
      error: null,
      meta: {
        requestTime: Date.now() - Date.now(), // Will be 0 but matches format
      },
    });

    // Add auto-refresh headers
    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Get circle details error:', error);

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
          details: {
            message: error.message,
          },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mobile/circles/[id]
 * Update circle details (creator only)
 *
 * Body:
 * - name?: string (3-100 chars)
 * - description?: string (max 500 chars)
 * - end_date?: string (ISO datetime, only if circle hasn't started)
 *
 * Permissions: Only creator can update
 * Restrictions:
 * - Cannot change start_date if circle already started
 * - Cannot change end_date if circle is active or completed
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const body = await request.json();

    // Validate input
    const validatedData = updateCircleSchema.parse(body);

    const supabaseAdmin = createAdminSupabase();

    // Get circle to verify permissions
    const { data: circle, error: fetchError } = await supabaseAdmin
      .from('challenges')
      .select('creator_id, start_date, end_date, status')
      .eq('id', circleId)
      .single();

    if (fetchError) {
      throw fetchError;
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

    // Check if user is creator
    if (circle.creator_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Only the circle creator can update circle details',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Check if circle has started (can't change end_date if active/completed)
    const now = new Date();
    const startDate = new Date(circle.start_date);
    const hasStarted = now >= startDate;

    if (validatedData.end_date && hasStarted) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cannot change end date for a circle that has already started',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    // Update circle
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('challenges')
      .update({
        ...(validatedData.name && { name: validatedData.name }),
        ...(validatedData.description && { description: validatedData.description }),
        ...(validatedData.end_date && { end_date: validatedData.end_date }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', circleId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`[Circle Update] Circle ${circleId} updated by creator ${user.id}`);

    let response = NextResponse.json({
      success: true,
      data: updated,
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Update circle error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors,
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

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

/**
 * DELETE /api/mobile/circles/[id]
 * Delete circle (creator only, only if status = 'upcoming')
 *
 * Permissions: Only creator can delete
 * Restrictions: Only 'upcoming' circles can be deleted
 * Cascade: Deletes members, invites, check-ins automatically via ON DELETE CASCADE
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;

    const supabaseAdmin = createAdminSupabase();

    // Get circle to verify permissions
    const { data: circle, error: fetchError } = await supabaseAdmin
      .from('challenges')
      .select('creator_id, status, start_date, end_date')
      .eq('id', circleId)
      .single();

    if (fetchError) {
      throw fetchError;
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

    // Check if user is creator
    if (circle.creator_id !== user.id) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Only the circle creator can delete the circle',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Determine current status (in case DB status is stale)
    const now = new Date();
    const startDate = new Date(circle.start_date);
    const endDate = new Date(circle.end_date);

    let actualStatus = 'upcoming';
    if (now >= startDate && now <= endDate) {
      actualStatus = 'active';
    } else if (now > endDate) {
      actualStatus = 'completed';
    }

    // Only allow deletion of upcoming circles
    if (actualStatus !== 'upcoming') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'Can only delete circles that have not started yet',
            details: { status: actualStatus },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    // Delete circle (cascade will handle related records)
    const { error: deleteError } = await supabaseAdmin
      .from('challenges')
      .delete()
      .eq('id', circleId);

    if (deleteError) {
      throw deleteError;
    }

    console.log(`[Circle Delete] Circle ${circleId} deleted by creator ${user.id}`);

    let response = NextResponse.json({
      success: true,
      data: {
        message: 'Circle deleted successfully',
        deleted_circle_id: circleId,
      },
      error: null,
      meta: null,
    });

    response = await addAutoRefreshHeaders(request, response, user);
    return response;
  } catch (error: any) {
    console.error('Delete circle error:', error);

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

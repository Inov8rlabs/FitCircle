import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleService } from '@/lib/services/circle-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import {
  isSameMoment,
  normalizeUpdateCircleBody,
  toEpochMillis,
  updateCircleSchema,
} from '@/lib/validation/circle-validation';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

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

    // Get leaderboard (contains recalculated progress)
    const leaderboard = await CircleService.getLeaderboard(circleId);

    // Get user's progress if they're a member - use recalculated value from leaderboard
    const userLeaderboardEntry = leaderboard.find((entry) => entry.user_id === user.id);
    const userMember = members.find((m) => m.user_id === user.id);

    const userProgress = userLeaderboardEntry
      ? {
          progress_percentage: userLeaderboardEntry.progress_percentage, // Use recalculated value
          current_value: userLeaderboardEntry.current_value,
          goal_target_value: userLeaderboardEntry.target_value,
          streak_days: userLeaderboardEntry.streak_days,
          check_ins_count: userMember?.check_ins_count || 0,
        }
      : null;

    // Get circle stats
    const stats = await CircleService.getCircleStats(circleId);

    // Map participants to include recalculated progress from leaderboard
    const participantsWithProgress = members.map((m) => {
      const leaderboardEntry = leaderboard.find((entry) => entry.user_id === m.user_id);
      return {
        user_id: m.user_id,
        progress_percentage: leaderboardEntry?.progress_percentage || 0, // Use recalculated value
        streak_days: m.streak_days,
        joined_at: m.joined_at,
      };
    });

    const response = NextResponse.json({
      success: true,
      data: {
        ...circle,
        participants: participantsWithProgress,
        leaderboard,
        userProgress,
        stats,
      },
      error: null,
      meta: {
        requestTime: Date.now() - Date.now(), // Will be 0 but matches format
      },
    });

    return await addAutoRefreshHeaders(request, response, user);
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
 * Body (snake_case; `startDate` / `endDate` are accepted as aliases):
 * - name?: string (3-100 chars)
 * - description?: string (max 500 chars); '' clears it, null = not sent
 * - start_date?: string (YYYY-MM-DD or ISO datetime)
 * - end_date?: string (YYYY-MM-DD or ISO datetime)
 *
 * Permissions: Only creator can update
 * Dates:
 * - A date equal to the stored one is not a change (iOS 1.0 always sends both
 *   dates, even when only the name was edited).
 * - end_date can only CHANGE while the circle has not started (400 otherwise).
 * - start_date can only CHANGE while the circle has not started. After that a
 *   different start_date is ignored, not rejected: the field used to be dropped
 *   silently, so rejecting it now would fail requests that used to succeed.
 *   `meta.ignored_fields` names what was ignored.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const body = await request.json();

    // Validate input (explicit nulls on optional fields are treated as "not sent")
    const validatedData = parseLenient(updateCircleSchema, normalizeUpdateCircleBody(body));

    const supabaseAdmin = createAdminSupabase();

    // Get circle to verify permissions
    const { data: circle, error: fetchError } = await supabaseAdmin
      .from('fitcircles')
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

    // Only a date that differs from the stored one counts as a change.
    const endChanged =
      validatedData.end_date !== undefined && !isSameMoment(validatedData.end_date, circle.end_date);
    const startChanged =
      validatedData.start_date !== undefined &&
      !isSameMoment(validatedData.start_date, circle.start_date);
    const applyStart = startChanged && !hasStarted;
    const ignoredFields = startChanged && hasStarted ? ['start_date'] : [];

    if (endChanged && hasStarted) {
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

    // The resulting range must still be valid (the table has CHECK end_date > start_date,
    // which would otherwise surface as a 500).
    if (applyStart || endChanged) {
      const effectiveStart = applyStart
        ? toEpochMillis(validatedData.start_date)
        : toEpochMillis(circle.start_date);
      const effectiveEnd = endChanged
        ? toEpochMillis(validatedData.end_date)
        : toEpochMillis(circle.end_date);

      if (effectiveStart !== null && effectiveEnd !== null && effectiveEnd <= effectiveStart) {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'End date must be after start date',
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: null,
          },
          { status: 400 }
        );
      }
    }

    // '' (or whitespace only) clears the description; undefined leaves it alone.
    const descriptionUpdate =
      validatedData.description === undefined
        ? {}
        : { description: validatedData.description.trim() === '' ? null : validatedData.description };

    // Moving the start date can move the circle out of "upcoming"; keep the
    // stored status in step with the dates (same rule as CircleService.getCircleStatus).
    let statusUpdate: { status?: 'upcoming' | 'active' | 'completed' } = {};
    if (applyStart) {
      const newStart = toEpochMillis(validatedData.start_date);
      const newEnd = toEpochMillis(endChanged ? validatedData.end_date : circle.end_date);
      if (newStart !== null) {
        if (now.getTime() < newStart) statusUpdate = { status: 'upcoming' };
        else if (newEnd !== null && now.getTime() > newEnd) statusUpdate = { status: 'completed' };
        else statusUpdate = { status: 'active' };
      }
    }

    // Update circle
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('fitcircles')
      .update({
        ...(validatedData.name && { name: validatedData.name }),
        ...descriptionUpdate,
        ...(applyStart && { start_date: validatedData.start_date }),
        ...(endChanged && { end_date: validatedData.end_date }),
        ...statusUpdate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', circleId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`[Circle Update] Circle ${circleId} updated by creator ${user.id}`);

    const response = NextResponse.json({
      success: true,
      data: updated,
      error: null,
      // null as before, unless a field had to be ignored.
      meta: ignoredFields.length > 0 ? { ignored_fields: ignoredFields } : null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Update circle error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationMessage(error),
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
      .from('fitcircles')
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
      .from('fitcircles')
      .delete()
      .eq('id', circleId);

    if (deleteError) {
      throw deleteError;
    }

    console.log(`[Circle Delete] Circle ${circleId} deleted by creator ${user.id}`);

    const response = NextResponse.json({
      success: true,
      data: {
        message: 'Circle deleted successfully',
        deleted_circle_id: circleId,
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
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

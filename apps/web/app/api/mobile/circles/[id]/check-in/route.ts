import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleService } from '@/lib/services/circle-service';
import { z } from 'zod';

/**
 * Validation schema for circle check-in
 */
const checkInSchema = z.object({
  value: z.number().min(0, 'Check-in value must be non-negative'),
  mood_score: z.number().min(1).max(5).optional(),
  energy_level: z.number().min(1).max(5).optional(),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/mobile/circles/[id]/check-in
 * Submit a daily check-in for a circle
 *
 * Body:
 * - value: number (required) - Current metric value (e.g., weight, steps)
 * - mood_score?: number (1-5, optional)
 * - energy_level?: number (1-5, optional)
 * - note?: string (max 500 chars, optional)
 *
 * Response:
 * - progress_percentage: number
 * - rank_change: number (positive = moved up, negative = moved down)
 * - streak_days: number
 * - milestone_reached?: string (e.g., "progress_50", "streak_7")
 * - new_rank: number
 *
 * Business Logic:
 * - Calls CircleService.submitCheckIn()
 * - Updates challenge_participants.current_value and progress_percentage
 * - Creates entry in circle_check_ins table
 * - Calculates streak and checks for milestones
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const body = await request.json();

    // Validate input
    const validatedData = checkInSchema.parse(body);

    // Submit check-in via CircleService
    const result = await CircleService.submitCheckIn(user.id, circleId, {
      value: validatedData.value,
      mood_score: validatedData.mood_score,
      energy_level: validatedData.energy_level,
      note: validatedData.note,
    });

    console.log(`[Circle Check-In] User ${user.id} checked in to circle ${circleId}`);

    const response = NextResponse.json({
      success: true,
      data: {
        progress_percentage: result.progress_percentage,
        rank_change: result.rank_change,
        streak_days: result.streak_days,
        milestone_reached: result.milestone_reached || null,
        new_rank: result.new_rank,
        checked_in_at: new Date().toISOString(),
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Circle check-in error:', error);

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

    // Handle specific CircleService errors
    if (error.message === 'You have already checked in today') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'ALREADY_CHECKED_IN',
            message: error.message,
            details: {},
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

    if (error.message?.includes('not a member')) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not a member of this circle',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
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

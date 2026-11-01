import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleJoinError, CircleService, InviteJoinError } from '@/lib/services/circle-service';
import { parseLenient } from '@/lib/validation/lenient-parse';

// Validation schema
const joinCircleSchema = z.object({
  inviteCode: z.string().min(1, 'Invite code is required'),
  // Personal referral code of the member who shared the link (…/join/CODE?ref=REF).
  ref: z.string().max(32).optional(),
  goal: z
    .object({
      goal_type: z.enum(['weight_loss', 'step_count', 'workout_frequency', 'custom']),
      goal_start_value: z.number().optional(),
      goal_target_value: z.number(),
      goal_unit: z.string(),
      goal_description: z.string().optional(),
    })
    .optional(),
});

/**
 * POST /api/mobile/circles/join
 * Join a circle using an invite code
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    // An explicit JSON null on an optional field (e.g. `goal: null`) means "not sent".
    const validatedData = parseLenient(joinCircleSchema, body);

    // One shared, idempotent join (CircleService.joinViaInvite): joinability,
    // capacity, member row, participant count, chat/lobby hooks, daily goals
    // and the referral attribution of a brand-new account.
    const result = await CircleService.joinViaInvite(user.id, validatedData.inviteCode, {
      goal: validatedData.goal ?? null,
      ref: validatedData.ref ?? null,
    });

    const updatedCircle = await CircleService.getCircle(result.circleId);

    if (result.status === 'already_member') {
      // Idempotent: already in (e.g. the invite claim seated them a moment
      // ago, or the creator opened their own link). 200, not 409, so shipped
      // apps that join after claiming land on the circle instead of an error.
      return NextResponse.json(
        {
          success: true,
          circle: updatedCircle,
          message: 'You are already a member of this circle',
          alreadyMember: true,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        circle: updatedCircle,
        message: 'Successfully joined the circle',
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Join circle error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    if (error instanceof InviteJoinError || error instanceof CircleJoinError) {
      return NextResponse.json(
        { error: 'Invalid invite', message: error.message },
        { status: 400 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: 'Invalid input data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message || 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';
import { readJsonBody } from '@/lib/streaks/request-body';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

const progressBodySchema = z.object({
  progress: z.number().min(0),
});

const idSchema = z.string().uuid();

/**
 * GET /api/mobile/challenges/daily/[id]/progress
 * Read the authenticated user's progress on the given daily challenge.
 *
 * Response data:
 * {
 *   challenge_id: string,
 *   user_progress: number,   // absolute units of the challenge, not a fraction
 *   is_completed: boolean,
 *   rank: number,
 *   user_joined: boolean     // additional field
 * }
 *
 * If the user is not yet a participant, returns progress=0, is_completed=false,
 * rank=0 (rather than 404) so the client can render a default state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);

    const progress = await DailyChallengeService.getUserProgress(user.id, challengeId);

    const response = NextResponse.json({
      success: true,
      data: progress,
      error: null,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid challenge id', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('[GET /api/mobile/challenges/daily/[id]/progress] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/challenges/daily/[id]/progress
 * Update the authenticated user's progress on the given daily challenge.
 *
 * Body: { progress: number }   // absolute units, the new total
 * Response data: { progress, is_completed, completed_at } plus the GET fields
 * (challenge_id, user_progress, rank) as additional keys.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let idIsValid = false;
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);
    idIsValid = true;

    const body = await readJsonBody(request);
    const { progress } = parseLenient(progressBodySchema, body);

    const result = await DailyChallengeService.updateProgress(user.id, challengeId, progress);

    return NextResponse.json({
      success: true,
      data: result,
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: idIsValid ? validationMessage(error) : 'Invalid challenge id',
            details: error.errors,
          },
        },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Not a participant') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_PARTICIPANT', message: 'Join the challenge first' } },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message === 'Challenge not found') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Challenge not found' } },
        { status: 404 }
      );
    }

    console.error('[POST /api/mobile/challenges/daily/[id]/progress] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

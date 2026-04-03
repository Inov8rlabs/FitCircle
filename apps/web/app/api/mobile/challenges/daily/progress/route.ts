import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

const progressSchema = z.object({
  challenge_id: z.string().uuid(),
  progress: z.number().min(0),
});

/**
 * POST /api/mobile/challenges/daily/progress
 * Update progress on today's daily challenge
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const { challenge_id, progress } = progressSchema.parse(body);

    const result = await DailyChallengeService.updateProgress(user.id, challenge_id, progress);

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
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.errors } },
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

    console.error('[POST /api/mobile/challenges/daily/progress] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

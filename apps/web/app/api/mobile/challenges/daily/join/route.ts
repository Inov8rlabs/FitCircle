import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

const joinSchema = z.object({
  challenge_id: z.string().uuid(),
});

/**
 * POST /api/mobile/challenges/daily/join
 * Join today's daily challenge
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const { challenge_id } = joinSchema.parse(body);

    const participant = await DailyChallengeService.joinChallenge(user.id, challenge_id);

    return NextResponse.json({
      success: true,
      data: participant,
      error: null,
    }, { status: 201 });
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

    console.error('[POST /api/mobile/challenges/daily/join] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

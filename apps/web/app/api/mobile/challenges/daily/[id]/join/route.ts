import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DailyChallengeService } from '@/lib/services/daily-challenge-service';

const idSchema = z.string().uuid();

/**
 * POST /api/mobile/challenges/daily/[id]/join
 * Join a daily challenge. Idempotent — joining an already-joined challenge
 * returns the existing participant row.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(_request);
    const { id } = await params;
    const challengeId = idSchema.parse(id);

    const participant = await DailyChallengeService.joinChallenge(user.id, challengeId);

    return NextResponse.json(
      { success: true, data: participant, error: null },
      { status: 201 }
    );
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

    console.error('[POST /api/mobile/challenges/daily/[id]/join] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

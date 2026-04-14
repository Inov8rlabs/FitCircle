import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeService } from '@/lib/services/circle-challenge-service';

const highFiveSchema = z.object({
  to_user_id: z.string().uuid(),
});

/**
 * POST /api/fitcircles/[id]/challenges/[challengeId]/high-fives
 * Send a high-five to another participant
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { challengeId } = await params;
    const body = await request.json();
    const validated = highFiveSchema.parse(body);

    await ChallengeService.sendHighFive(challengeId, user.id, validated.to_user_id);

    return NextResponse.json({
      success: true,
      data: null,
      error: null,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } },
        { status: 401 }
      );
    }
    return NextResponse.json(
      { success: false, data: null, error: { code: 'ERROR', message: error.message } },
      { status: 400 }
    );
  }
}

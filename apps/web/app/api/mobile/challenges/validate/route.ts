import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CustomChallengeService, CustomChallengeInput } from '@/lib/services/custom-challenge-service';

/**
 * POST /api/mobile/challenges/validate
 * Dry-run validation + difficulty estimate for custom challenge data
 */
export async function POST(request: NextRequest) {
  try {
    await requireMobileAuth(request);
    const body = await request.json();

    const result = CustomChallengeService.validateChallenge(body as CustomChallengeInput);

    return NextResponse.json({
      success: true,
      data: result,
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

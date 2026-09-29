import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CustomChallengeService, type CustomChallengeInput } from '@/lib/services/custom-challenge-service';

/**
 * POST /api/mobile/challenges/validate
 * Dry-run validation + difficulty estimate for custom challenge data
 */
export async function POST(request: NextRequest) {
  try {
    await requireMobileAuth(request);
    const raw: unknown = await request.json();

    // This dry run has no schema (its job is to REPORT what is wrong), so explicit
    // nulls are dropped by hand: a null field reads as a missing field.
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== null))
        : {};

    const result = CustomChallengeService.validateChallenge(body as unknown as CustomChallengeInput);

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

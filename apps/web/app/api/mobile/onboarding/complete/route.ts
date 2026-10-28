import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { AssessmentService } from '@/lib/services/assessment-service';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { completeBodySchema, OnboardingFlowService } from '@/lib/services/onboarding-flow-service';

/**
 * POST /api/mobile/onboarding/complete
 * Mark onboarding as done. Optional body (1.1.0+): { birthYear?, dateOfBirth? },
 * saved to profiles.date_of_birth (docs/USER_TARGETS_CONTRACT.md §3). Shipped
 * clients send no body or {} — unchanged for them.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    let body: unknown = {};
    try {
      const text = await request.text();
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    // Completing onboarding must never fail on the optional birth date: an
    // invalid one is ignored here (progress / plan return 400 for it instead).
    const birth = completeBodySchema.safeParse(body && typeof body === 'object' && !Array.isArray(body) ? body : {});
    if (birth.success) await OnboardingFlowService.saveBirthDate(user.id, birth.data);

    const result = await AssessmentService.completeOnboarding(user.id);
    // Onboarding is already complete here; a failed read must not report otherwise.
    const profile = await MobileAPIService.getUserProfileWithStats(user.id).catch((error) => {
      console.error('[Mobile API] Onboarding complete: profile read failed:', error?.message);
      return {};
    });

    return NextResponse.json({
      success: true,
      // iOS decodes `data` as its `User`; Android and web read success/xpAwarded.
      data: { ...profile, ...result },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
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

    console.error('[Mobile API] Complete onboarding error:', error.message);

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

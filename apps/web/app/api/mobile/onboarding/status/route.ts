import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { AssessmentService } from '@/lib/services/assessment-service';
import { OnboardingFlowService } from '@/lib/services/onboarding-flow-service';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * GET /api/mobile/onboarding/status
 * Get current onboarding progress and next steps.
 *
 * Additive (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md R2): `shouldResume`
 * (not completed AND account < 30 days old) and `resume` ({flow, step, data,
 * updatedAt} from PATCH /onboarding/progress, or null). Every legacy field is
 * unchanged.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const [status, resume] = await Promise.all([
      AssessmentService.getOnboardingStatus(user.id),
      OnboardingFlowService.getResume(user.id),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: { ...status, shouldResume: resume.shouldResume, resume: resume.resume },
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { headers: NO_STORE }
    );
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
        { status: 401, headers: NO_STORE }
      );
    }

    console.error('[Mobile API] Get onboarding status error:', error.message);

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
      { status: 500, headers: NO_STORE }
    );
  }
}

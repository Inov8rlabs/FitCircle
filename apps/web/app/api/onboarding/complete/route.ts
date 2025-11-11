import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { OnboardingService } from '@/lib/services/onboarding-service';

/**
 * POST /api/onboarding/complete
 * Mark onboarding as complete
 * - Award achievement
 * - Grant XP
 * - Set user status to active
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    console.log('[Onboarding API] Completing onboarding for user:', user.id);

    const result = await OnboardingService.completeOnboarding(user.id);

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Onboarding API] Complete onboarding error:', error);

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

    if (error.message === 'User not found') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to complete onboarding',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

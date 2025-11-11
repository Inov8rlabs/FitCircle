import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FirstCheckInSchema } from '@/lib/types/onboarding';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { z } from 'zod';

/**
 * POST /api/onboarding/first-checkin
 * Record initial measurements and first check-in
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const validatedData = FirstCheckInSchema.parse(body);

    console.log('[Onboarding API] Recording first check-in for user:', user.id);

    // Record first check-in
    await OnboardingService.recordFirstCheckIn(user.id, validatedData);

    return NextResponse.json({
      success: true,
      data: {
        message: 'First check-in recorded successfully',
        checkIn: validatedData,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Onboarding API] First check-in error:', error);

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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid check-in data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to record check-in',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

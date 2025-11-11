import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { QuestionnaireAnswersSchema } from '@/lib/types/onboarding';
import { OnboardingService } from '@/lib/services/onboarding-service';
import { z } from 'zod';

/**
 * POST /api/onboarding/persona
 * Submit questionnaire answers, calculate persona, and store results
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const validatedData = QuestionnaireAnswersSchema.parse(body);

    console.log('[Onboarding API] Processing questionnaire for user:', user.id);

    // Process questionnaire and detect persona
    const personaResult = await OnboardingService.processQuestionnaire(user.id, validatedData);

    return NextResponse.json({
      success: true,
      data: {
        persona: personaResult,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Onboarding API] Persona detection error:', error);

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
            message: 'Invalid questionnaire answers',
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
          message: 'Failed to process questionnaire',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

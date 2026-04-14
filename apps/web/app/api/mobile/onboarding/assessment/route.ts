import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { AssessmentService } from '@/lib/services/assessment-service';

const assessmentSchema = z.object({
  exercise_frequency: z.enum(['never', '1-2x_week', '3-4x_week', 'daily']),
  primary_goal: z.enum(['lose_weight', 'gain_muscle', 'improve_cardio', 'maintain_health', 'stress_relief']),
  preferred_workouts: z.array(
    z.enum(['cardio', 'strength', 'yoga', 'sports', 'dancing', 'outdoor', 'home_workouts'])
  ).min(1, 'Select at least one workout type'),
  daily_time: z.enum(['15min', '30min', '45min', '60min', '90min+']),
  fitness_self_assessment: z.enum(['complete_beginner', 'some_experience', 'regular_exerciser', 'very_fit']),
});

/**
 * POST /api/mobile/onboarding/assessment
 * Submit all assessment responses
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    const body = await request.json();
    const responses = assessmentSchema.parse(body);

    const result = await AssessmentService.submitAssessment(user.id, responses);

    return NextResponse.json({
      success: true,
      data: {
        fitnessLevel: result.fitnessLevel,
        timeCommitment: result.timeCommitment,
        preferredWorkoutTypes: result.preferredWorkoutTypes,
      },
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

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid assessment data',
            details: error.errors.reduce((acc: any, err: any) => {
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

    console.error('[Mobile API] Submit assessment error:', error.message);

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

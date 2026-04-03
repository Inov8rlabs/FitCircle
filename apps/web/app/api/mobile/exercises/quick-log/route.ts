import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { WorkoutLoggingService } from '@/lib/services/workout-logging-service';

const quickLogSchema = z.object({
  brand: z.string().min(1).max(50),
  category: z.enum(['cardio', 'strength', 'flexibility', 'sports', 'outdoor', 'other']),
  duration_minutes: z.number().int().min(1).max(1440),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/mobile/exercises/quick-log
 * Simplified workout logging with brand + category + duration
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const validated = quickLogSchema.parse(body);

    const result = await WorkoutLoggingService.quickLog(user.id, {
      brand: validated.brand,
      category: validated.category,
      duration_minutes: validated.duration_minutes,
      notes: validated.notes,
    });

    return NextResponse.json({
      success: true,
      data: {
        exercise: result.exercise,
        momentum: result.momentum,
        counts_as_checkin: validated.duration_minutes >= 10,
      },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
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
            details: error.errors.reduce(
              (acc: Record<string, string>, err) => {
                acc[err.path.join('.')] = err.message;
                return acc;
              },
              {}
            ),
          },
        },
        { status: 400 }
      );
    }

    console.error('[POST /api/mobile/exercises/quick-log] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { WorkoutLoggingService } from '@/lib/services/workout-logging-service';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';
import { quickLogCategorySchema } from '@/lib/validators/quick-log';

const quickLogSchema = z.object({
  brand: z.string().min(1).max(50),
  // The six stored categories pass through; anything else (iOS sends hiit / cycling /
  // general) is mapped to the closest stored one instead of a 400.
  category: quickLogCategorySchema,
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
    const validated = parseLenient(quickLogSchema, body);

    const timezone = resolveClientTimezone(request, body?.timezone);
    const result = await WorkoutLoggingService.quickLog(user.id, {
      brand: validated.brand,
      category: validated.category,
      duration_minutes: validated.duration_minutes,
      notes: validated.notes,
      timezone,
    });

    // Quick-log is always a manual workout → claims today (user-local).
    const streak = await StreakClaimingService.autoClaimForManualLog(user.id, {
      occurredAt: (result.exercise?.exercise_date as string | undefined) ?? null,
      timezone,
      source: 'exercise_log',
      referenceId: result.exercise?.id as string | undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        exercise: result.exercise,
        momentum: result.momentum,
        counts_as_checkin: validated.duration_minutes >= 10,
        // Additive: the keys the iOS QuickLogResponse model decodes
        // (exercise_log with logged_at, momentum_updated, new_momentum_day).
        exercise_log: {
          ...result.exercise,
          brand: (result.exercise?.brand as string | null | undefined) ?? validated.brand,
          logged_at: result.exercise?.created_at ?? new Date().toISOString(),
        },
        momentum_updated: result.momentum != null,
        new_momentum_day: Number(result.momentum?.new_momentum ?? 0) || 0,
      },
      meta: { requestTime: Date.now() - startTime, streak },
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
            message: validationMessage(error),
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

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionCoachService } from '@/lib/services/nutrition-coach-service';
import { UpgradeRequiredError } from '@/lib/services/usage-service';
import type { CoachResponse } from '@/lib/types/nutrition-coach';

/**
 * POST /api/mobile/nutrition-coach
 * PRD v4 §6.9 — AI Nutrition Coach. Stateless Q&A for v1 (no history persisted).
 *
 * Body: { question: string, circleId?: string } → CoachResponse { answer, disclaimer }.
 *
 * Thin route: all coaching logic and the mandatory §6.9/§6.7 guardrails (system prompt +
 * output check) live in NutritionCoachService. The service never returns unsafe content and
 * never throws on bad model output, so this route just authenticates, validates input, and
 * relays the result in the standard mobile envelope.
 */

const requestSchema = z.object({
  question: z.string().trim().min(1, 'Question must not be empty').max(500, 'Question is too long'),
  circleId: z.string().trim().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid request body',
            details: { issues: parsed.error.issues },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const { question, circleId } = parsed.data;

    const result: CoachResponse = await NutritionCoachService.ask(user.id, question, circleId);

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Nutrition coach error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UPGRADE_REQUIRED',
            message: "You've used today's free coach messages — go Pro for unlimited coaching.",
            details: { feature: error.feature, used: error.used, limit: error.limit },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 429 }
      );
    }

    if (error?.message === 'RateLimited') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'RATE_LIMITED', message: "You've reached today's message limit — try again tomorrow.", details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() },
        meta: null,
      },
      { status: 500 }
    );
  }
}

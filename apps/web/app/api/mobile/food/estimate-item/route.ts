import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';

// LLM parse can exceed the platform default function timeout; give it room.
export const maxDuration = 60;

/**
 * POST /api/mobile/food/estimate-item
 * PRD v4 §6.1 ("tap to fix") — re-estimate the macros for ONE food the user corrected on the
 * confirm card. The user fixes the name (and/or portion) of a single ingredient and we recompute
 * its calories/macros for that exact food + amount, grounded against the foods DB.
 *
 * JSON body: { name: string, grams?: number, quantity?: number, servingUnit?: string }
 * Returns a single enriched draft item (same shape as one element of photo-parse's `items`).
 *
 * Text-only (no premium vision call), but still counts toward the shared per-user daily
 * paid-parse cap — exceeding it returns 429 (handled below).
 * Thin route: all nutrition logic lives in NutritionIntelligenceService (§7.2.1).
 */

const bodySchema = z.object({
  name: z.string().trim().min(1, 'Name is empty').max(200, 'Name too long'),
  grams: z.number().positive().max(100000).optional(),
  quantity: z.number().positive().max(100000).optional(),
  servingUnit: z.string().trim().max(40).optional(),
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 400 }
      );
    }

    const parsed = bodySchema.safeParse(json);
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

    try {
      const item = await NutritionIntelligenceService.estimateItem(
        user.id,
        parsed.data.name,
        parsed.data.grams,
        parsed.data.quantity,
        parsed.data.servingUnit,
      );

      return NextResponse.json({
        success: true,
        data: item,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      });
    } catch (estimateError: any) {
      // Per-user daily soft cap hit on paid parses (§9.2) → 429 with a friendly message.
      if (estimateError?.message === 'RateLimited') {
        return NextResponse.json(
          {
            success: false,
            data: null,
            error: {
              code: 'RATE_LIMITED',
              message: "You've reached today's estimate limit — try again tomorrow or set the macros yourself.",
              details: {},
              timestamp: new Date().toISOString(),
            },
            meta: { requestTime: Date.now() - startTime },
          },
          { status: 429 }
        );
      }
      if (estimateError?.message !== 'ParseFailed') {
        throw estimateError; // Unauthorized / unexpected → outer catch
      }
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'PARSE_FAILED',
            message: "Couldn't estimate that food — try a clearer name or set the macros yourself.",
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: { requestTime: Date.now() - startTime },
        },
        { status: 422 }
      );
    }
  } catch (error: any) {
    console.error('[Mobile API] Estimate item error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}

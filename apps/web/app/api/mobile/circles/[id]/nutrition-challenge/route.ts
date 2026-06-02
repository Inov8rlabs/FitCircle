import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionChallengeService } from '@/lib/services/nutrition-challenge-service';
import {
  type NutritionChallengeResponseDTO,
  NUTRITION_METRIC_TYPES,
} from '@/lib/types/nutrition-challenge';

/**
 * Nutrition-driven challenge metrics (PRD v4 §6.5).
 *
 * GET  /api/mobile/circles/[id]/nutrition-challenge
 *   Returns the configured nutrition metric (or null) + per-member progress over the
 *   challenge window. §6.7: ranking is adherence/consistency only — never restriction.
 *
 * POST /api/mobile/circles/[id]/nutrition-challenge  { metricType, targetValue }
 *   Upserts the nutrition metric for the challenge. Creator only.
 *
 * Thin route: all computation/authorization lives in NutritionChallengeService.
 */

const setConfigSchema = z.object({
  metricType: z.enum(
    NUTRITION_METRIC_TYPES as unknown as [string, ...string[]]
  ),
  targetValue: z.number().positive().nullable().optional(),
});

function errorResponse(error: any, fallbackStatus = 500) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'Forbidden') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'FORBIDDEN', message: 'You are not allowed to perform this action on this circle', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error?.message === 'NotFound') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Circle not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 404 }
    );
  }
  if (error?.message === 'BadRequest' || error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error instanceof z.ZodError ? error.errors : {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error('[Mobile API] nutrition-challenge error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: fallbackStatus }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    const [config, progress] = await Promise.all([
      NutritionChallengeService.getConfig(id, user.id),
      NutritionChallengeService.computeProgress(id, user.id),
    ]);

    const data: NutritionChallengeResponseDTO = { config, progress };

    return NextResponse.json({
      success: true,
      data,
      meta: { requestTime: Date.now() - startTime, count: progress.rows.length },
      error: null,
    });
  } catch (error: any) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    const body = await request.json();
    const validated = setConfigSchema.parse(body);

    const config = await NutritionChallengeService.setConfig(
      id,
      user.id,
      validated.metricType as (typeof NUTRITION_METRIC_TYPES)[number],
      validated.targetValue ?? null
    );

    return NextResponse.json({
      success: true,
      data: { config },
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return errorResponse(error);
  }
}

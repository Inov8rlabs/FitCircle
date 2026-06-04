import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { DietaryPreferencesService } from '@/lib/services/dietary-preferences-service';
import { setDietaryPreferencesSchema } from '@/lib/types/dietary-prefs';

/**
 * Dietary preferences / allergens + units (PRD v4 §6.15).
 *
 *   GET  /api/mobile/dietary-preferences  → resolved DietaryPreferencesDTO (defaults applied).
 *   POST /api/mobile/dietary-preferences  → upsert { diet?, allergens?, units? }, returns DTO.
 *
 * Thin routes: all defaulting/locale-inference/normalization lives in DietaryPreferencesService.
 * Units are display-only — the API returns the preference; the client formats canonical
 * grams/kcal accordingly (no backend conversion).
 */

function unauthorized() {
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

function serverError() {
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

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const prefs = await DietaryPreferencesService.getPrefs(user.id);
    return NextResponse.json({
      success: true,
      data: prefs,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return unauthorized();
    console.error('[Mobile API] Dietary preferences GET error:', error?.message);
    return serverError();
  }
}

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

    const parsed = setDietaryPreferencesSchema.safeParse(body);
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

    const prefs = await DietaryPreferencesService.setPrefs(user.id, parsed.data);
    return NextResponse.json({
      success: true,
      data: prefs,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return unauthorized();
    console.error('[Mobile API] Dietary preferences POST error:', error?.message);
    return serverError();
  }
}

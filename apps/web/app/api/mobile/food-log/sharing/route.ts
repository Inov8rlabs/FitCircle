/**
 * "Share new meals with my circles" — the user's default for new food entries
 * (docs/FOOD_ENTRY_PRIVACY_SPEC.md §API).
 *
 * GET /api/mobile/food-log/sharing
 *   200 { success, data: { share_meals_with_circles: boolean }, error: null, meta: null }
 * PUT /api/mobile/food-log/sharing   body { share_meals_with_circles: boolean }
 *   200 same shape (the saved value) · 400 VALIDATION_ERROR · 401 UNAUTHORIZED
 *
 * Stored in profiles.preferences.privacy.share_meals_with_circles, so every
 * device agrees; unset means OFF (new meals are private). Changing it never
 * touches existing entries.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodEntryPrivacyService } from '@/lib/services/food-entry-privacy-service';

const BodySchema = z.object({ share_meals_with_circles: z.boolean() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

function ok(share: boolean) {
  return NextResponse.json(
    { success: true, data: { share_meals_with_circles: share }, error: null, meta: null },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

function failure(error: any, label: string) {
  if (error?.message === 'Unauthorized') return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
  console.error(`[Mobile API] ${label}:`, error?.message);
  return errorResponse('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    return ok(await FoodEntryPrivacyService.getShareDefault(user.id));
  } catch (error: any) {
    return failure(error, 'Get meal sharing default');
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    // Invalid JSON reads as no body → VALIDATION_ERROR below.
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('VALIDATION_ERROR', 'share_meals_with_circles (boolean) is required', 400);
    }
    return ok(await FoodEntryPrivacyService.setShareDefault(user.id, parsed.data.share_meals_with_circles));
  } catch (error: any) {
    return failure(error, 'Set meal sharing default');
  }
}

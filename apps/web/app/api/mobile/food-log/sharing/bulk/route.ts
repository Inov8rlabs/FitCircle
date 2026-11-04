/**
 * POST /api/mobile/food-log/sharing/bulk — "Make all past meals private"
 * (docs/FOOD_ENTRY_PRIVACY_SPEC.md §Bulk).
 *
 * Body: { share_with_circles: false }
 *   200 { success, data: { entries_made_private, posts_removed }, error: null, meta: null }
 *   400 VALIDATION_ERROR (missing body) · 400 UNSUPPORTED (share_with_circles: true —
 *       sharing all past meals at once is deliberately not offered) · 401 · 500 (safe to retry)
 *
 * Idempotent: a repeat call returns zeros. Every live entry of the caller
 * becomes private and every live meal card of theirs leaves every circle chat
 * before the response. The user's default for NEW meals is not changed.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodEntryPrivacyService } from '@/lib/services/food-entry-privacy-service';

const BodySchema = z.object({ share_with_circles: z.boolean() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    // Invalid JSON reads as no body → VALIDATION_ERROR below.
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('VALIDATION_ERROR', 'share_with_circles (boolean) is required', 400);
    }
    if (parsed.data.share_with_circles) {
      return errorResponse('UNSUPPORTED', 'Sharing all past meals at once is not supported', 400);
    }
    const result = await FoodEntryPrivacyService.makeAllPrivate(user.id);
    return NextResponse.json(
      { success: true, data: result, error: null, meta: null },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    console.error('[Mobile API] Bulk meal privacy:', error?.message);
    return errorResponse('INTERNAL_SERVER_ERROR', 'Could not update your meals. Please try again.', 500);
  }
}

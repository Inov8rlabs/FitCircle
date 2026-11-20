/**
 * GET /api/mobile/food-log/share-targets — the circles the meal-logged success sheet offers
 * (docs/ENGAGEMENT_115_SPEC.md §4.3–4.4, docs/ENGAGEMENT_115_CLIENT_CONTRACT.md §4).
 *
 * 200 { success, data: { sharing_default: 'on'|'off'|'unset', circles: [{ circle_id, name,
 *   member_count, avatar_urls (≤3), default_on, reason }] (≤30, recent chat activity → name) },
 *   error: null, meta: null }
 * 401 UNAUTHORIZED · 500 (retry-safe). Cache-Control: private, no-store.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MealShareService } from '@/lib/services/meal-share-service';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: NO_STORE }
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const data = await MealShareService.getShareTargets(user.id);
    return NextResponse.json({ success: true, error: null, meta: null, data }, { headers: NO_STORE });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return errorResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
    console.error('[Mobile API] Meal share targets:', error?.message);
    return errorResponse('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }
}

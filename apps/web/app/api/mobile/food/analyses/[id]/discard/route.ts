/**
 * POST /api/mobile/food/analyses/{analysisId}/discard — the user discarded an AI result before
 * saving it (docs/ENGAGEMENT_115_SPEC.md §14.6). It will never become a Draft meal; the held
 * photo is deleted. Idempotent: always 200 `{ discarded: boolean }` (false = unknown, already
 * saved / discarded / drafted, or drafts are off). A result that already became a draft is
 * discarded with the normal DELETE /api/mobile/food-log/{entryId}.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MealDraftService, isAnalysisId } from '@/lib/services/meal-draft-service';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;
    if (!isAnalysisId(id)) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid analysis id', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 400, headers: NO_STORE }
      );
    }
    const discarded = await MealDraftService.resolve(user.id, id, 'discarded');
    return NextResponse.json({ success: true, data: { discarded }, error: null, meta: { requestTime: Date.now() - startTime } }, { headers: NO_STORE });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401, headers: NO_STORE }
      );
    }
    console.error('[Mobile API] Discard analysis error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500, headers: NO_STORE }
    );
  }
}

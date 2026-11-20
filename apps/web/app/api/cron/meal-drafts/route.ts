import { type NextRequest, NextResponse } from 'next/server';

import { MealDraftService } from '@/lib/services/meal-draft-service';

/**
 * GET /api/cron/meal-drafts — Draft meals (docs/ENGAGEMENT_115_SPEC.md §14.6). Every 15 min:
 * AI results left unsaved for 30 minutes become Draft meals; drafts older than 14 days are
 * deleted with their photos. CRON_SECRET-gated, FAIL CLOSED. No-op until MEAL_DRAFTS_ENABLED=true
 * (after migration 139); MEAL_DRAFT_PROMOTION_ENABLED=false stops new drafts (cleanup still runs).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const promotion = await MealDraftService.promoteDue();
    const cleanup = await MealDraftService.cleanup();
    return NextResponse.json({ success: true, promotion, cleanup });
  } catch (err: any) {
    console.error('[Cron meal-drafts] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'meal drafts failed' }, { status: 500 });
  }
}

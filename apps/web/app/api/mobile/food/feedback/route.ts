import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionTrainingService } from '@/lib/services/nutrition-training-service';
import { nutritionFeedbackSchema } from '@/lib/types/nutrition';

/**
 * POST /api/mobile/food/feedback — thumbs up/down on an AI draft (confirm card).
 *
 * JSON body: { parseHash: string, rating: 'up' | 'down', comment?: string }
 * Returns { recorded: boolean } — false when no draft row carries that parseHash for this user
 * (e.g. training capture is off), which the client treats as success.
 * Thin route: the write lives in NutritionTrainingService (§7.2.1).
 */
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
    const parsed = nutritionFeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid feedback',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 },
      );
    }
    const recorded = await NutritionTrainingService.rateDraft({ userId: user.id, ...parsed.data });
    return NextResponse.json({ success: true, data: { recorded }, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 },
      );
    }
    console.error('[Mobile API] Nutrition feedback error:', message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_ERROR', message: 'Could not record feedback', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 },
    );
  }
}

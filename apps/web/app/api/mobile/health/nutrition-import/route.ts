import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { HealthNutritionService } from '@/lib/services/health-nutrition-service';
import { importNutritionRequestSchema } from '@/lib/types/health-nutrition';

/**
 * POST /api/mobile/health/nutrition-import — idempotent batch import of platform nutrition
 * (HealthKit / Health Connect / MFP) into the food log. Deduped by external id. PRD §6.2.
 * Body: { platform, items: ImportedNutritionItem[], cursor? }.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const req = importNutritionRequestSchema.parse(body);
    const result = await HealthNutritionService.importBatch(user.id, req);
    return NextResponse.json({ success: true, data: result, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid import payload', details: error.errors.reduce((a: any, e) => { a[e.path.join('.')] = e.message; return a; }, {}), timestamp: new Date().toISOString() }, meta: null },
        { status: 400 }
      );
    }
    console.error('[Mobile API] nutrition-import error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}

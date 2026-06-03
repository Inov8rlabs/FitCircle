import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { HealthNutritionService } from '@/lib/services/health-nutrition-service';

/**
 * GET  /api/mobile/health/nutrition-sync — all platforms' sync state for the user.
 * POST /api/mobile/health/nutrition-sync — toggle a platform: body { platform, enabled }.
 * PRD §6.2.
 */
const toggleSchema = z.object({
  platform: z.enum(['healthkit', 'healthconnect', 'mfp']),
  enabled: z.boolean(),
});

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const state = await HealthNutritionService.getState(user.id);
    return NextResponse.json({ success: true, data: state, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    return mapError(error);
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const { platform, enabled } = toggleSchema.parse(body);
    const state = await HealthNutritionService.setEnabled(user.id, platform, enabled);
    return NextResponse.json({ success: true, data: state, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    return mapError(error);
  }
}

function mapError(error: any) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors.reduce((a: any, e) => { a[e.path.join('.')] = e.message; return a; }, {}), timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error('[Mobile API] nutrition-sync error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

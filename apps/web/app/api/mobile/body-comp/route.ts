import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BodyCompositionService, stripSegmentalData } from '@/lib/services/body-composition-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { bodyCompCreateSchema, bodyCompListQuerySchema } from '@/lib/types/body-composition';

/**
 * POST /api/mobile/body-comp — create a body-composition log (upsert on
 *   (user, measured_at, source)) → 201 BodyCompLog.
 * GET  /api/mobile/body-comp?start=&end=&limit=&before= — newest-first journal page
 *   → { logs, hasMore, nextBefore }.
 * Feature gates: body_comp_logging (403), body_comp_segmental (server-side too:
 * gated users neither write nor read the segmental field — the log itself still
 * saves, since segmental is a display-tier add-on, not its own endpoint).
 * BODY_COMP_BUILD_CONTRACT §2.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_logging');
    const body = await request.json();
    const input = bodyCompCreateSchema.parse(body);
    const canSegmental = await EntitlementService.isFeatureAllowed(user.id, 'body_comp_segmental');
    if (!canSegmental) delete input.segmental;
    const log = await BodyCompositionService.createLog(user.id, input);
    return NextResponse.json(
      {
        success: true,
        data: canSegmental ? log : stripSegmentalData(log),
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return mapError(error);
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_logging');
    const { searchParams } = new URL(request.url);
    const query = bodyCompListQuerySchema.parse({
      start: searchParams.get('start') ?? undefined,
      end: searchParams.get('end') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      before: searchParams.get('before') ?? undefined,
    });
    const result = await BodyCompositionService.listLogs(user.id, query);
    const canSegmental = await EntitlementService.isFeatureAllowed(user.id, 'body_comp_segmental');
    const data = canSegmental ? result : { ...result, logs: result.logs.map(stripSegmentalData) };
    return NextResponse.json({ success: true, data, meta: { requestTime: Date.now() - startTime }, error: null });
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
  if (error?.message === 'PREMIUM_REQUIRED') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'PREMIUM_REQUIRED', message: 'This feature requires a premium subscription', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors.reduce((a: any, e) => { a[e.path.join('.')] = e.message; return a; }, {}), timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error('[Mobile API] body-comp error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

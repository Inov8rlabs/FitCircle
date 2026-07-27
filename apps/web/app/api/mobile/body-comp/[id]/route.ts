import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BodyCompositionService, stripSegmentalData } from '@/lib/services/body-composition-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { bodyCompUpdateSchema } from '@/lib/types/body-composition';

/**
 * PUT    /api/mobile/body-comp/{id} — partial update → BodyCompLog.
 * DELETE /api/mobile/body-comp/{id} — → { deleted: true }.
 * Feature gates: body_comp_logging (403), body_comp_segmental (server-side too:
 * gated users neither write nor read the segmental field). BODY_COMP_BUILD_CONTRACT §2.
 */
const idSchema = z.string().uuid();

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_logging');
    const { id } = await params;
    const logId = idSchema.parse(id);
    const body = await request.json();
    const patch = bodyCompUpdateSchema.parse(body);
    const canSegmental = await EntitlementService.isFeatureAllowed(user.id, 'body_comp_segmental');
    if (!canSegmental) delete patch.segmental;
    const log = await BodyCompositionService.updateLog(user.id, logId, patch);
    return NextResponse.json({
      success: true,
      data: canSegmental ? log : stripSegmentalData(log),
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return mapError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_logging');
    const { id } = await params;
    const logId = idSchema.parse(id);
    const result = await BodyCompositionService.deleteLog(user.id, logId);
    return NextResponse.json({ success: true, data: result, meta: { requestTime: Date.now() - startTime }, error: null });
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
  if (error?.message === 'NOT_FOUND') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Body composition log not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 404 }
    );
  }
  if (error?.message === 'DUPLICATE_ENTRY') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'DUPLICATE_ENTRY', message: 'Another entry from the same source already exists at that date and time', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 409 }
    );
  }
  if (error?.message === 'AT_LEAST_ONE_METRIC_REQUIRED') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'At least one of weightKg, bodyFatPct, skeletalMuscleMassKg, fatMassKg must remain set', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors.reduce((a: any, e) => { a[e.path.join('.')] = e.message; return a; }, {}), timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error('[Mobile API] body-comp [id] error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BodyCompositionService, stripSegmentalData } from '@/lib/services/body-composition-service';
import { EntitlementService } from '@/lib/services/entitlement-service';

/**
 * GET /api/mobile/body-comp/latest — most recent log or null (dashboard card).
 * Feature gates: body_comp_logging (403), body_comp_segmental (segmental stripped
 * from the response while gated). BODY_COMP_BUILD_CONTRACT §2.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_logging');
    const log = await BodyCompositionService.getLatest(user.id);
    const canSegmental =
      !log?.segmental || (await EntitlementService.isFeatureAllowed(user.id, 'body_comp_segmental'));
    return NextResponse.json({
      success: true,
      data: log && !canSegmental ? stripSegmentalData(log) : log,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
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
  console.error('[Mobile API] body-comp latest error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

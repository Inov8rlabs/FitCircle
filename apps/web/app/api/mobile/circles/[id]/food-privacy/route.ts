import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodPrivacyService } from '@/lib/services/food-privacy-service';
import { FOOD_PRIVACY_TIERS } from '@/lib/types/food-privacy';

/**
 * Per-circle food privacy tier for the AUTHENTICATED user (PRD §6.4).
 *  GET  /api/mobile/circles/[id]/food-privacy        -> { tier }
 *  POST /api/mobile/circles/[id]/food-privacy { tier } -> { tier }
 *
 * Thin route: the default + fail-closed logic lives in FoodPrivacyService. A user can only
 * read/write their OWN tier — the user id is taken from the auth context, never the body.
 */

const setTierSchema = z.object({
  tier: z.enum(FOOD_PRIVACY_TIERS as unknown as [string, ...string[]]),
});

const service = new FoodPrivacyService();

function unauthorized() {
  return NextResponse.json(
    { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 401 }
  );
}

function serverError(error: any) {
  console.error('[Mobile API] Food privacy error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;

    const tier = await service.getTier(circleId, user.id);

    return NextResponse.json({
      success: true,
      data: { fitcircleId: circleId, tier },
      error: null,
      meta: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return unauthorized();
    return serverError(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: circleId } = await params;
    const body = await request.json();

    const parsed = setTierSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'tier must be one of: full, summary, private', details: parsed.error.errors, timestamp: new Date().toISOString() }, meta: null },
        { status: 400 }
      );
    }

    const tier = await service.setTier(circleId, user.id, parsed.data.tier as any);

    return NextResponse.json({
      success: true,
      data: { fitcircleId: circleId, tier },
      error: null,
      meta: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return unauthorized();
    return serverError(error);
  }
}

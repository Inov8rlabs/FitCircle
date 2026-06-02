import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleFoodFeedService } from '@/lib/services/circle-food-feed-service';

/**
 * GET /api/mobile/circles/[id]/food-feed?before=&limit=
 * PRD v4 §6.3 — reverse-chronological, paginated circle food feed (food logs promoted
 * into circle content). Active-member gated. Thin route; logic lives in the service.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before') ?? undefined;
    const limitRaw = searchParams.get('limit');

    const result = await CircleFoodFeedService.getFeed(id, user.id, {
      before,
      limit: limitRaw ? parseInt(limitRaw, 10) : undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime, count: result.cards.length },
      error: null,
    });
  } catch (error: any) {
    return mapError(error, 'food-feed');
  }
}

function mapError(error: any, label: string) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'Forbidden') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'FORBIDDEN', message: 'You are not a member of this circle', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error?.message === 'NotFound') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Circle not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 404 }
    );
  }
  console.error(`[Mobile API] ${label} error:`, error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

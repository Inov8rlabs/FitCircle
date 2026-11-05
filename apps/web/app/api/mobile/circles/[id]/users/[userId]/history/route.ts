import { type NextRequest, NextResponse } from 'next/server';

import { toLegacyWeightEntries } from '@/lib/circles/member-progress';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { CircleNotFoundError, MemberProgressService } from '@/lib/services/member-progress-service';
import { normalizeId } from '@/lib/validation/circle-validation';

/**
 * GET /api/mobile/circles/[id]/users/[userId]/history
 * Get user check-in history within circle context
 *
 * Privacy: when the owner hides their progress the answer is 200 with
 * `can_view: false` and no entries. It used to be an empty list with
 * `can_view: true`, which the apps showed as "no check-ins yet".
 *
 * Shipped iOS (1.1.0/1.1.1) and Android (1.1.1) render `entries[].weight` as a
 * weight in kg, so this route only ever puts a real weight there: a weight
 * circle's weigh-ins (respecting show_weight and per-row is_public, no 0 /
 * future rows); any other circle answers `entries: []`. It used to put a steps
 * circle's daily step totals in `weight` ("10,109 steps" → "22,286.5 lbs").
 * `metric` / `unit` are additive. New clients read `/circle-progress`
 * (docs/MEMBER_PROGRESS_CONTRACT.md), which carries every metric.
 *
 * Query params:
 * - limit: number (default: 30, max: 100)
 * - offset: number (default: 0)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id: rawCircleId, userId: rawUserId } = await params;
    // iOS sends uppercase uuids in the path; the owner check compares strings.
    const userId = normalizeId(rawUserId);
    const circleId = normalizeId(rawCircleId);

    // Get query params
    const { searchParams } = new URL(request.url);
    const parsedLimit = parseInt(searchParams.get('limit') || '30');
    const parsedOffset = parseInt(searchParams.get('offset') || '0');
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 30;
    const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    console.log(`[Circle User History] User ${user.id} viewing history ${userId} in circle ${circleId} (limit: ${limit}, offset: ${offset})`);

    const progress = await MemberProgressService.getMemberCircleProgress(userId, user.id, circleId);
    const isWeight = progress.metric === 'weight';
    // Non-weight circles: nothing in the weight-shaped list. Hidden progress
    // (incl. weight hidden by show_weight) is can_view false.
    const canView = progress.can_view;
    const all = canView && isWeight ? toLegacyWeightEntries(progress.entries) : [];
    const page = all.slice(offset, offset + limit);
    const history = {
      entries: page,
      total_count: all.length,
      has_more: all.length > offset + limit,
      metric: 'weight' as const,
      unit: 'kg' as const,
      circle_metric: progress.metric,
    };

    const response = NextResponse.json(
      {
        success: true,
        data: {
          ...history,
          can_view: canView,
        },
        error: null,
        meta: {
          requestTime: Date.now(),
          limit,
          offset,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store', // 2 minutes
        },
      }
    );

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('[Circle User History] Error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error instanceof CircleNotFoundError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'NOT_FOUND', message: error.message, details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 404 }
      );
    }

    if (error.message?.includes('private') || error.message?.includes('Progress data')) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: error.message || 'Cannot access history data',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

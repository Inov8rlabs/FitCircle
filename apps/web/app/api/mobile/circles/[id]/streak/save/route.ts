import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleStreakService } from '@/lib/services/circle-streak-service';

/**
 * POST /api/mobile/circles/[id]/streak/save
 * Body: { coveredUserId: string, date?: string (YYYY-MM-DD, defaults to today UTC) }
 *
 * PRD v4 §6.13 — pro-social "streak save": the caller (saver) covers another active
 * member once per period. The covered member then counts as "logged" for that day's
 * recompute (forgiveness-first; never punish a lapse). Active-member gated for both
 * saver and covered. Thin route; logic lives in the service.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      coveredUserId?: unknown;
      date?: unknown;
    };

    const coveredUserId = typeof body.coveredUserId === 'string' ? body.coveredUserId.trim() : '';
    if (!coveredUserId) {
      throw new Error('BadRequest:coveredUserId is required');
    }

    let date: string;
    if (body.date === undefined || body.date === null) {
      date = new Date().toISOString().split('T')[0];
    } else if (typeof body.date === 'string' && DATE_RE.test(body.date)) {
      date = body.date;
    } else {
      throw new Error('BadRequest:date must be a YYYY-MM-DD string');
    }

    const result = await CircleStreakService.useSave(id, user.id, coveredUserId, date);

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return mapError(error, 'circle-streak-save');
  }
}

function mapError(error: any, label: string) {
  const message: string = error?.message ?? '';
  if (message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (message === 'Forbidden') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'FORBIDDEN', message: 'Both saver and covered member must be active members of this circle', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (message === 'NotFound') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Circle not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 404 }
    );
  }
  if (message.startsWith('BadRequest:')) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'BAD_REQUEST', message: message.slice('BadRequest:'.length), details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error(`[Mobile API] ${label} error:`, error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

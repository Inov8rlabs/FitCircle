import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { PlateScoreService } from '@/lib/services/plate-score-service';

/**
 * GET /api/mobile/plate-score/range?start=YYYY-MM-DD&end=YYYY-MM-DD
 * PRD §6.8 — list cached Plate Scores across an inclusive date range, newest first.
 * Does not back-compute missing days (a history view shows what was scored).
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const start = validDate(searchParams.get('start'));
    const end = validDate(searchParams.get('end'));

    if (!start || !end) {
      return badRequest('start and end are required and must be YYYY-MM-DD');
    }
    if (start > end) {
      return badRequest('start must be on or before end');
    }

    const results = await PlateScoreService.getRange(user.id, start, end);

    return NextResponse.json({
      success: true,
      data: results,
      meta: { requestTime: Date.now() - startTime, count: results.length },
      error: null,
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }
    console.error('[Mobile API] Plate score range error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}

function badRequest(message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code: 'BAD_REQUEST', message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 400 }
  );
}

function validDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : raw;
}

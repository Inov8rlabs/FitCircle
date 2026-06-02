import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { PlateScoreService } from '@/lib/services/plate-score-service';

/**
 * GET /api/mobile/plate-score?date=YYYY-MM-DD  (defaults to today, UTC)
 * PRD §6.8 — single glanceable 0–100 daily nutrition score. Reads the cached
 * score for the day, computing + caching it if missing. Thin route; logic lives
 * in PlateScoreService.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const date = normalizeDate(searchParams.get('date'));
    if (!date) {
      return badRequest('date must be in YYYY-MM-DD format');
    }

    const result = await PlateScoreService.getForDay(user.id, date);

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    return mapError(error, 'Plate score');
  }
}

function badRequest(message: string) {
  return NextResponse.json(
    { success: false, data: null, error: { code: 'BAD_REQUEST', message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 400 }
  );
}

function mapError(error: any, label: string) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  console.error(`[Mobile API] ${label} error:`, error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

/** Validate YYYY-MM-DD; default to today (UTC) when missing. Returns null if invalid. */
function normalizeDate(raw: string | null): string | null {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const m = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  if (!m) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
}

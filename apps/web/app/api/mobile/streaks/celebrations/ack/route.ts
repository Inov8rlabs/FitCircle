/**
 * POST /api/mobile/streaks/celebrations/ack { milestone: number } → 204.
 * Clears the pending celebration for that milestone (docs/ENGAGEMENT_115_SPEC.md §5.4). Idempotent.
 * 400 VALIDATION_ERROR · 401 UNAUTHORIZED · 500.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { StreakCelebrationService } from '@/lib/services/streak-celebration-service';
import { safeParseLenient } from '@/lib/validation/lenient-parse';

const BodySchema = z.object({ milestone: z.number().int().min(1).max(100_000) });

const fail = (status: number, code: string, message: string) =>
  NextResponse.json(
    { success: false, data: null, meta: null, error: { code, message, details: {}, timestamp: new Date().toISOString() } },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );

export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body: unknown = await request.json().catch(() => undefined);
    const parsed = safeParseLenient(BodySchema, body);
    if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'milestone (integer) is required');
    await StreakCelebrationService.ack(user.id, parsed.data.milestone);
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
    console.error('[POST /api/mobile/streaks/celebrations/ack]', error?.message);
    return fail(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { challengeErrorResponse, normalizeId, readJsonBody } from '@/lib/http/circle-challenge-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChallengeService } from '@/lib/services/circle-challenge-service';
import { MAX_LOG_AMOUNT } from '@/lib/types/circle-challenge';
import { parseLenient } from '@/lib/validation/lenient-parse';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Longer notes are accepted and cut to the stored length (80) by the service. */
const MAX_NOTE_INPUT_LENGTH = 500;

/**
 * Body of POST. iOS and the web app omit `note` when empty; Android may send
 * `"note": null` (handled by `parseLenient`). A numeric string is accepted for
 * `amount`. The day and the timestamp are always assigned by the server.
 */
const logActivitySchema = z.object({
  amount: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value),
    z
      .number({ invalid_type_error: 'Amount must be a number', required_error: 'Amount is required' })
      .finite('Amount must be a number')
      .positive('Amount must be greater than 0')
      .max(MAX_LOG_AMOUNT, `Amount must be at most ${MAX_LOG_AMOUNT}`)
  ),
  note: z.string().max(MAX_NOTE_INPUT_LENGTH).optional(),
});

/** A whole number from the query string, clamped; anything unusable is the fallback. */
function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * GET /api/fitcircles/[id]/challenges/[challengeId]/logs?limit=&offset=
 * The caller's own activity logs for the challenge, newest first.
 * Returns `data: CircleChallengeLog[]` (an empty list when the caller has not joined).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id, challengeId } = await params;

    const { searchParams } = new URL(request.url);
    const limit = intParam(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = intParam(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);

    const logs = await ChallengeService.getMyLogs(
      normalizeId(challengeId),
      user.id,
      limit,
      offset,
      normalizeId(id)
    );

    return NextResponse.json({ success: true, data: logs, error: null });
  } catch (error: unknown) {
    return challengeErrorResponse(error, 'List activity logs');
  }
}

/**
 * POST /api/fitcircles/[id]/challenges/[challengeId]/logs
 * Log activity toward the challenge. Body: `{ amount: number, note?: string }`.
 * Returns `data: LogActivityResponse` (the log, the caller's updated totals and rank).
 *
 * Errors: 400 VALIDATION_ERROR / CHALLENGE_NOT_STARTED / CHALLENGE_ENDED /
 * CHALLENGE_NOT_ACTIVE / DAILY_LIMIT_REACHED, 403 FORBIDDEN / NOT_A_PARTICIPANT,
 * 404 NOT_FOUND, 409 DUPLICATE_DETECTED.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; challengeId: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id, challengeId } = await params;

    const body = await readJsonBody(request);
    const validated = parseLenient(logActivitySchema, body);

    const result = await ChallengeService.logActivity(
      normalizeId(challengeId),
      user.id,
      { amount: validated.amount, note: validated.note },
      normalizeId(id)
    );

    return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
  } catch (error: unknown) {
    return challengeErrorResponse(error, 'Log activity');
  }
}

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CheerError, CircleCheerService } from '@/lib/services/circle-cheer-service';
import { resolveClientTimezone } from '@/lib/streaks/client-timezone';
import { CHEER_MESSAGE_MAX_LENGTH, CHEER_SOURCES, type CheerSource } from '@/lib/types/circle-chat';
import { isUuid, normalizeId } from '@/lib/validation/circle-validation';

const cheerSchema = z.object({
  to_user_id: z.string().uuid(),
  // Canonicalised / validated by the service (named kind or one emoji).
  reaction: z.string().max(64).nullish(),
  // Length is checked after trimming in the service; this only bounds the payload.
  message: z.string().max(CHEER_MESSAGE_MAX_LENGTH * 4).nullish(),
  source: z.enum(CHEER_SOURCES as [CheerSource, ...CheerSource[]]).nullish(),
  client_id: z.string().uuid().nullish(),
});

const STATUS: Record<CheerError['code'], number> = {
  VALIDATION_ERROR: 400,
  CANNOT_CHEER_SELF: 400,
  FORBIDDEN: 403,
  BLOCKED: 403,
  RECIPIENT_NOT_FOUND: 404,
  RATE_LIMITED: 429,
};

/**
 * POST /api/mobile/circles/[id]/cheers
 * Cheer a circle member from the leaderboard: posts a cheer message into the
 * circle chat (realtime via the circle_messages insert), pushes the member
 * cheered (always alerts) and the rest of the circle (ordinary chat push).
 * Contract: docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §3
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id: rawId } = await params;
    if (!isUuid(rawId)) return fail('INVALID_CIRCLE_ID', 'Invalid circle ID format', 400);

    const raw = await request.json().catch(() => null);
    const parsed = cheerSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      const details = parsed.error.errors.reduce<Record<string, string>>((acc, err) => {
        acc[err.path.join('.') || 'body'] = err.message;
        return acc;
      }, {});
      return fail('VALIDATION_ERROR', 'Invalid input data', 400, details);
    }
    const body = parsed.data;

    const message = await CircleCheerService.sendCheer(normalizeId(rawId), user.id, {
      toUserId: normalizeId(body.to_user_id),
      reaction: body.reaction ?? null,
      message: body.message ?? null,
      source: body.source ?? null,
      clientId: body.client_id ?? null,
      clientTimezone: resolveClientTimezone(request),
    });

    return NextResponse.json(
      { success: true, data: { message }, error: null, meta: { requestTime: Date.now() - startTime } },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error: any) {
    if (error instanceof CheerError) {
      const headers: Record<string, string> = {};
      if (error.code === 'RATE_LIMITED' && typeof error.details.retry_after_seconds === 'number') {
        headers['Retry-After'] = String(error.details.retry_after_seconds);
      }
      return fail(error.code, error.message, STATUS[error.code], error.details, headers);
    }
    if (error?.message === 'Unauthorized') return fail('UNAUTHORIZED', 'Invalid or expired token', 401);
    console.error('[Mobile API] Cheer error:', error?.message ?? error);
    return fail('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }
}

function fail(
  code: string,
  message: string,
  status: number,
  details: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status, headers: { 'Cache-Control': 'private, no-store', ...headers } }
  );
}

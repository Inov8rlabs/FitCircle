/**
 * POST /api/mobile/notifications/opened { notification_id, action? }
 *
 * The app reports a push tap. `notification_id` is the push payload's
 * data.notification_id (= notification_log.id, a UUID). Sets
 * notification_log.opened_at on the caller's own row, first open only.
 * Idempotent: a repeat (retry, second tap) is also 204.
 *
 *   204 — recorded (or already recorded)
 *   400 VALIDATION_ERROR — notification_id missing / not a UUID, or a malformed action
 *   401 UNAUTHORIZED, 404 NOT_FOUND (no such row for this user), 500
 *
 * docs/PUSH_NOTIFICATIONS.md §7. The older POST /api/mobile/notifications/[id]/opened
 * stays for compatibility (no shipped client calls it).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { reportRouteError } from '@/lib/api/route-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { markNotificationOpened, OPEN_ACTION_PATTERN } from '@/lib/notifications/notification-opens';
import { fail } from '@/lib/referrals/http';
import { safeParseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    notification_id: z.string().trim().uuid(),
    action: z.string().trim().regex(OPEN_ACTION_PATTERN).optional(),
  })
  .passthrough();

export async function POST(request: NextRequest) {
  let user: { id: string };
  try {
    user = await requireMobileAuth(request);
  } catch {
    return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const parsed = safeParseLenient(bodySchema, body);
  if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'notification_id (uuid) is required; action must be a short id');
  try {
    const result = await markNotificationOpened(user.id, parsed.data.notification_id.toLowerCase(), { action: parsed.data.action });
    if (result === 'not_found') return fail(404, 'NOT_FOUND', 'Notification not found');
    return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    reportRouteError('POST /api/mobile/notifications/opened', error, { status: 500 });
    return fail(500, 'INTERNAL_SERVER_ERROR', 'Failed to record the notification open');
  }
}

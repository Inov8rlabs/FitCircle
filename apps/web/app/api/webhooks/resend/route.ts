import { type NextRequest, NextResponse } from 'next/server';

import { reportRouteError } from '@/lib/api/route-errors';
import {
  firstDelivery,
  forgetDelivery,
  handleResendEvent,
  resendWebhookEnabled,
  verifySvix,
  type ResendEvent,
} from '@/lib/email/resend-webhook';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/resend — Resend delivery events (docs/EMAIL_QUALITY.md §C).
 *
 *  - Svix signature on the raw body (RESEND_WEBHOOK_SECRET): 401 when wrong,
 *    stale (> 5 min, replay) or missing; 503 when the secret isn't configured.
 *  - email.bounced (Permanent) / email.complained → the address goes on the
 *    suppression list, which every FitCircle email send checks.
 *  - every handled event → one `[email-event]` log line (engagement metrics).
 *  - RESEND_WEBHOOK_ENABLED=false → verified, acknowledged (200), ignored.
 *  - processing failure → 500 so Resend retries (writes are idempotent).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhooks/resend] RESEND_WEBHOOK_SECRET is not set — rejecting (Resend will retry). See docs/EMAIL_QUALITY.md.');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });

  const svixId = request.headers.get('svix-id');
  const verdict = verifySvix(
    secret,
    { id: svixId, timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') },
    body
  );
  if (verdict !== 'ok') {
    console.warn('[webhooks/resend] rejected:', verdict);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch (error) {
    console.warn('[webhooks/resend] invalid JSON:', (error as Error)?.message);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!resendWebhookEnabled()) return NextResponse.json({ received: true, disabled: true });
  if (svixId && !firstDelivery(svixId)) return NextResponse.json({ received: true, duplicate: true });

  try {
    const result = await handleResendEvent(event);
    if (result.handled && result.suppressFailed > 0) {
      // Couldn't record a bounce/complaint (e.g. migration 127 not applied): make Resend retry.
      if (svixId) forgetDelivery(svixId);
      return NextResponse.json({ error: 'Suppression not recorded' }, { status: 500 });
    }
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (svixId) forgetDelivery(svixId);
    reportRouteError('webhooks/resend', error, { code: event?.type });
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

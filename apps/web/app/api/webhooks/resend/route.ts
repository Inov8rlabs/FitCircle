import { type NextRequest, NextResponse } from 'next/server';

import { fitCircleAdapters } from '@/lib/engagement/adapters';
import { handleResendEvent, verifySvix, type ResendEvent } from '@/lib/engagement/resend-webhook';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/resend — Resend delivery / engagement events
 * (delivered, opened, clicked, bounced, complained) → engagement_sends
 * timestamps + tracking-plan analytics; hard bounces and spam complaints stop
 * further engagement email. Svix-signed (RESEND_WEBHOOK_SECRET), verified on
 * the raw body; 401 when the signature is wrong or the secret is unset.
 * Unknown emails (campaign, referral invites) are acknowledged with 200.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const verified = verifySvix(
    process.env.RESEND_WEBHOOK_SECRET,
    { id: request.headers.get('svix-id'), timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') },
    body
  );
  if (!verified) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const result = await handleResendEvent(event, fitCircleAdapters());
    return NextResponse.json({ received: true, ...result });
  } catch (err: any) {
    // 5xx → Resend retries (stamps are idempotent).
    console.error('[webhooks/resend] failed:', event?.type, err?.message);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

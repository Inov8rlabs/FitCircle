import { createHash, timingSafeEqual } from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import {
  SubscriptionService,
  type RevenueCatEvent,
} from '@/lib/services/subscription-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/revenuecat — the single writer of subscription state.
 *
 * RevenueCat is configured (dashboard → Integrations → Webhooks) to send every
 * subscription lifecycle event here with a fixed Authorization header; that header
 * is the shared secret (REVENUECAT_WEBHOOK_AUTH_TOKEN). Verification is
 * constant-time and fails CLOSED: no configured secret → 500, never fail-open.
 *
 * Response contract (per RevenueCat retry semantics):
 *  - 200 for anything handled OR deliberately skipped (duplicates, stale events,
 *    unknown users, sandbox-in-prod) — retrying would not change the outcome.
 *  - 401 for bad auth.
 *  - 500 only for transient failures (DB down) where a retry can succeed.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH_TOKEN;
  if (!expected) {
    console.error('[RevenueCat webhook] REVENUECAT_WEBHOOK_AUTH_TOKEN is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const provided = request.headers.get('authorization') ?? '';
  // Hash both sides so timingSafeEqual gets equal-length buffers regardless of input length.
  const providedDigest = createHash('sha256').update(provided).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(providedDigest, expectedDigest)) {
    console.warn('[RevenueCat webhook] rejected: bad authorization header');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let event: RevenueCatEvent | undefined;
  try {
    const body = await request.json();
    event = body?.event;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!event?.id || !event?.type) {
    return NextResponse.json({ error: 'Missing event' }, { status: 400 });
  }

  // Sandbox events reaching production are recorded for audit but never applied.
  const sandboxInProd =
    event.environment === 'SANDBOX' &&
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_SANDBOX_WEBHOOKS !== 'true';

  try {
    const outcome = await SubscriptionService.processRevenueCatEvent(event, {
      apply: !sandboxInProd,
    });
    if (outcome !== 'applied') {
      console.log(`[RevenueCat webhook] ${event.type} ${event.id}: ${outcome}`);
    }
    return NextResponse.json({ received: true, outcome });
  } catch (error: any) {
    console.error('[RevenueCat webhook] processing failed:', error?.message, event.id);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

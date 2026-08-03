import { type NextRequest, NextResponse } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';
import { BillingService, getStripe } from '@/lib/services/billing-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/stripe — signature-verified Stripe events.
 *
 * Deliberately dumb: this route NEVER writes entitlement state. Its one critical
 * job is forwarding completed checkouts to RevenueCat (which then emits the
 * events our RevenueCat webhook applies). Failure of that forward returns 500
 * so Stripe retries until RevenueCat has the receipt.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.startsWith('whsec_your')) {
    console.error('[Stripe webhook] STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // Raw body is required for signature verification — read text before any parsing.
  const payload = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error: any) {
    console.warn('[Stripe webhook] signature verification failed:', error?.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency: record 'stripe:<id>'; a duplicate delivery is a no-op 200.
  const supabase = createAdminSupabase();
  const { error: insertError } = await supabase.from('subscription_events').insert({
    id: `stripe:${event.id}`,
    type: event.type,
    store: 'STRIPE',
    environment: event.livemode ? 'PRODUCTION' : 'SANDBOX',
    event_timestamp: new Date(event.created * 1000).toISOString(),
    raw: event as any,
  });
  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, outcome: 'already_processed' });
    }
    console.error('[Stripe webhook] event record failed:', insertError.message);
    return NextResponse.json({ error: 'Storage failure' }, { status: 500 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const appUserId =
          session.metadata?.app_user_id ?? session.client_reference_id ?? null;
        if (!appUserId) {
          console.error('[Stripe webhook] checkout session without app_user_id:', session.id);
          break; // nothing to retry — misconfigured checkout
        }

        // Persist the customer id (findOrCreateCustomer usually did already; restores drift).
        if (typeof session.customer === 'string') {
          await supabase
            .from('profiles')
            .update({ stripe_customer_id: session.customer })
            .eq('id', appUserId);
        }

        // Subscription checkouts hand RevenueCat the subscription id; one-time
        // (lifetime) checkouts hand it the session id.
        const fetchToken =
          typeof session.subscription === 'string' ? session.subscription : session.id;
        await BillingService.forwardReceiptToRevenueCat(appUserId, fetchToken);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as { customer?: string | null };
        console.warn('[Stripe webhook] invoice.payment_failed for customer:', invoice.customer);
        // Entitlement consequences (grace/past_due) arrive via RevenueCat BILLING_ISSUE.
        break;
      }

      default:
        break; // recorded, no action
    }
    return NextResponse.json({ received: true });
  } catch (error: any) {
    // Delete the idempotency row so Stripe's retry re-attempts the forward.
    await supabase.from('subscription_events').delete().eq('id', `stripe:${event.id}`);
    console.error('[Stripe webhook] processing failed:', error?.message, event.id);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

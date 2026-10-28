import Stripe from 'stripe';

import { createAdminSupabase } from '../supabase-admin';

/**
 * BillingService — web (Stripe) purchase plumbing.
 *
 * Stripe handles web checkout and self-serve management ONLY. It never writes
 * entitlement state: after checkout completes, the Stripe webhook forwards the
 * subscription to RevenueCat (`forwardReceiptToRevenueCat`), RevenueCat begins
 * tracking the Stripe subscription lifecycle, and its webhook (the single
 * entitlement writer — see subscription-service.ts) updates profiles.
 */

export type WebPlan = 'monthly' | 'annual' | 'lifetime';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith('sk_test_your')) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  if (!stripeClient) stripeClient = new Stripe(key);
  return stripeClient;
}

/** Test hook: inject a Stripe stand-in (null restores the real client). */
export function setStripeClientForTest(client: unknown): void {
  stripeClient = client as Stripe | null;
}

/** Postgres "undefined column" — profiles.trial_started_at before migration 112. */
const UNDEFINED_COLUMN = '42703';

function priceIdFor(plan: WebPlan): string {
  const id = {
    monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
    annual: process.env.STRIPE_PRICE_PRO_ANNUAL,
    lifetime: process.env.STRIPE_PRICE_PRO_LIFETIME,
  }[plan];
  if (!id) throw new Error(`Stripe price id for plan '${plan}' is not configured`);
  return id;
}

export class BillingService {
  /** Find the user's Stripe customer or create one, persisting the id on the profile. */
  static async findOrCreateCustomer(userId: string, email: string | null): Promise<string> {
    const supabase = createAdminSupabase();
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    if (profile?.stripe_customer_id) return profile.stripe_customer_id;

    const customer = await getStripe().customers.create({
      email: email ?? undefined,
      metadata: { app_user_id: userId },
    });
    await supabase
      .from('profiles')
      .update({ stripe_customer_id: customer.id })
      .eq('id', userId);
    return customer.id;
  }

  /**
   * Web free trial eligibility: one trial per person, across every store
   * (ONBOARDING_V2_EXPERIMENT_SPEC §3.1 — Apple and Google enforce this for
   * their own stores; Stripe does not). Eligible only when the user has never
   * trialed or subscribed anywhere:
   *  - profiles.trial_started_at is null (a missing column before migration
   *    112 is treated as "no data"; the next two checks still apply),
   *  - no real subscription_events rows (RevenueCat's TEST events and SANDBOX
   *    events are ignored — they are not a real trial or purchase),
   *  - the existing Stripe customer, if any, has no subscriptions of any status.
   * Fail-closed: any other read error means no trial (the plan's normal price
   * is still offered).
   */
  static async isWebTrialEligible(userId: string, existingCustomerId: string | null): Promise<boolean> {
    try {
      const supabase = createAdminSupabase();
      const [trial, events] = await Promise.all([
        supabase.from('profiles').select('trial_started_at').eq('id', userId).maybeSingle(),
        supabase.from('subscription_events').select('id, type, environment').eq('user_id', userId).limit(50),
      ]);
      if (trial.error && trial.error.code !== UNDEFINED_COLUMN) throw new Error(trial.error.message);
      if (trial.data?.trial_started_at) return false;
      if (events.error) throw new Error(events.error.message);
      const real = ((events.data ?? []) as { type?: string; environment?: string | null }[]).filter(
        (e) => e.type !== 'TEST' && e.environment !== 'SANDBOX'
      );
      if (real.length > 0) return false;
      if (existingCustomerId) {
        const subs = await getStripe().subscriptions.list({ customer: existingCustomerId, status: 'all', limit: 1 });
        if ((subs.data ?? []).length > 0) return false;
      }
      return true;
    } catch (err: any) {
      console.warn('[BillingService] trial eligibility check failed; no trial offered:', err?.message);
      return false;
    }
  }

  /**
   * Create a Checkout Session for a plan. Annual carries an optional STRIPE_TRIAL_DAYS trial and,
   * while STRIPE_COUPON_LAUNCH is set, the launch first-period discount
   * (renewals bill at list price — coupons with duration 'once' only touch the
   * first invoice). Monthly gets the same optional trial. Launch config: no trial.
   */
  static async createCheckoutSession(params: {
    userId: string;
    email: string | null;
    plan: WebPlan;
    origin: string;
  }): Promise<{ url: string }> {
    const { userId, email, plan, origin } = params;
    const configuredTrialDays = Number(process.env.STRIPE_TRIAL_DAYS ?? 0) || 0;
    const stripe = getStripe();
    const isSubscription = plan !== 'lifetime';
    // The customer id that existed BEFORE this checkout (a fresh one has no history).
    const { data: before } = await createAdminSupabase()
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .maybeSingle();
    const trialDays =
      configuredTrialDays > 0 && isSubscription && (await this.isWebTrialEligible(userId, before?.stripe_customer_id ?? null))
        ? configuredTrialDays
        : 0;
    const customerId = await this.findOrCreateCustomer(userId, email);

    const launchCoupon = process.env.STRIPE_COUPON_LAUNCH || undefined;

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? 'subscription' : 'payment',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceIdFor(plan), quantity: 1 }],
      metadata: { app_user_id: userId, plan },
      ...(isSubscription
        ? {
            subscription_data: {
              // STRIPE_TRIAL_DAYS (3 from ONBOARDING_V2) — only for users who have
              // never trialed or subscribed on any store (isWebTrialEligible).
              ...(trialDays > 0 ? { trial_period_days: trialDays } : {}),
              metadata: { app_user_id: userId, plan },
            },
            ...(plan === 'annual' && launchCoupon
              ? { discounts: [{ coupon: launchCoupon }] }
              : { allow_promotion_codes: true }),
          }
        : {}),
      // `plan` / `checkout` let the return pages report the purchase funnel
      // (Purchase Completed / Cancelled) without another Stripe lookup.
      success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${origin}/upgrade?checkout=cancelled&plan=${plan}`,
    });

    if (!session.url) throw new Error('Stripe did not return a checkout URL');
    return { url: session.url };
  }

  /** Stripe Billing Portal session for self-serve manage/cancel (web subscribers only). */
  static async createPortalSession(customerId: string, origin: string): Promise<{ url: string }> {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings/billing`,
    });
    return { url: session.url };
  }

  /**
   * Hand a completed Stripe purchase to RevenueCat so it becomes the tracked
   * source of truth. fetch_token is the Stripe subscription id for subscriptions,
   * or the Checkout Session id for one-time (lifetime) purchases.
   * Throws on failure — the Stripe webhook returns 500 so Stripe retries;
   * this forward is the critical hop.
   */
  static async forwardReceiptToRevenueCat(appUserId: string, fetchToken: string): Promise<void> {
    // The v1 receipts endpoint takes the Stripe app's PUBLIC key (strp_…); a v2
    // secret key is rejected there, so never fall back to it.
    const apiKey = process.env.REVENUECAT_STRIPE_PUBLIC_API_KEY;
    if (!apiKey) throw new Error('REVENUECAT_STRIPE_PUBLIC_API_KEY is not configured');

    const res = await fetch('https://api.revenuecat.com/v1/receipts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Platform': 'stripe',
      },
      body: JSON.stringify({ app_user_id: appUserId, fetch_token: fetchToken }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`RevenueCat receipt forward failed: ${res.status} ${text.slice(0, 300)}`);
    }
  }
}

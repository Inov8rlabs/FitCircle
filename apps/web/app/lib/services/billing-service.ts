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
   * Create a Checkout Session for a plan. Annual carries the 7-day trial and,
   * while STRIPE_COUPON_LAUNCH is set, the launch first-period discount
   * (renewals bill at list price — coupons with duration 'once' only touch the
   * first invoice). Monthly also gets the 7-day trial per the offering design.
   */
  static async createCheckoutSession(params: {
    userId: string;
    email: string | null;
    plan: WebPlan;
    origin: string;
  }): Promise<{ url: string }> {
    const { userId, email, plan, origin } = params;
    const stripe = getStripe();
    const customerId = await this.findOrCreateCustomer(userId, email);

    const launchCoupon = process.env.STRIPE_COUPON_LAUNCH || undefined;
    const isSubscription = plan !== 'lifetime';

    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? 'subscription' : 'payment',
      customer: customerId,
      client_reference_id: userId,
      line_items: [{ price: priceIdFor(plan), quantity: 1 }],
      metadata: { app_user_id: userId, plan },
      ...(isSubscription
        ? {
            subscription_data: {
              trial_period_days: 7,
              metadata: { app_user_id: userId, plan },
            },
            ...(plan === 'annual' && launchCoupon
              ? { discounts: [{ coupon: launchCoupon }] }
              : { allow_promotion_codes: true }),
          }
        : {}),
      success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/upgrade`,
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
    const apiKey =
      process.env.REVENUECAT_STRIPE_PUBLIC_API_KEY || process.env.REVENUECAT_SECRET_API_KEY;
    if (!apiKey) throw new Error('RevenueCat API key is not configured');

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

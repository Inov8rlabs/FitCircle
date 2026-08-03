import { type NextRequest, NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase-server';
import { BillingService, type WebPlan } from '@/lib/services/billing-service';
import { EntitlementService } from '@/lib/services/entitlement-service';

export const dynamic = 'force-dynamic';

const PLANS: WebPlan[] = ['monthly', 'annual', 'lifetime'];

/**
 * POST /api/billing/checkout {plan: 'monthly'|'annual'|'lifetime'}
 * Web-session authenticated. Returns {url} — the client redirects to Stripe Checkout.
 * Already-Pro users get 409 (manage instead; cross-platform double-subscription guard).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Master feature flag: the whole subscription surface is dark until the
    // 'subscriptions' feature_flags row is enabled (fail-closed).
    if (!(await EntitlementService.areSubscriptionsEnabled(user.id))) {
      return NextResponse.json(
        { error: 'SUBSCRIPTIONS_DISABLED', message: 'Subscriptions are not available yet.' },
        { status: 403 }
      );
    }

    let plan: WebPlan | undefined;
    try {
      const body = await request.json();
      plan = body?.plan;
    } catch {
      /* fall through to validation */
    }
    if (!plan || !PLANS.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier, subscription_platform')
      .eq('id', user.id)
      .single();
    if (profile?.subscription_tier && profile.subscription_tier !== 'free') {
      return NextResponse.json(
        {
          error: 'Already subscribed',
          platform: profile.subscription_platform ?? null,
          message:
            profile.subscription_platform === 'stripe'
              ? 'You already have FitCircle Pro. Manage it from Settings → Billing.'
              : 'You already have FitCircle Pro via the App Store or Google Play. Manage it there.',
        },
        { status: 409 }
      );
    }

    const origin = request.headers.get('origin') ?? new URL(request.url).origin;
    const { url } = await BillingService.createCheckoutSession({
      userId: user.id,
      email: user.email ?? null,
      plan,
      origin,
    });
    return NextResponse.json({ url });
  } catch (error: any) {
    console.error('[billing/checkout] failed:', error?.message);
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 500 });
  }
}

'use client';

/**
 * /upgrade — the FitCircle Pro pricing page (web paywall).
 * Annual pre-selected; checkout runs through Stripe (POST /api/billing/checkout);
 * entitlement lands via RevenueCat → backend webhook → profiles.
 */

import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Navbar } from '@/components/layout/navbar';
import { PricingCards, PlanComparison } from '@/components/billing/PricingCards';
import { ProBadge } from '@/components/billing/ProBadge';
import { useEntitlements } from '@/hooks/useEntitlements';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { paywallSource, takeCheckout, webProductId } from '@/lib/analytics/checkout';
import { useTrackOnce } from '@/lib/analytics/react';

export default function UpgradePage() {
  const { entitlements, isPro, isLoading } = useEntitlements();
  // ?source=<placement> names the entry point (landing, streak_shield, ...).
  // Read from window (not useSearchParams) so the page needs no Suspense boundary.
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let resolved = paywallSource(params.get('source'));
    if (params.get('checkout') === 'cancelled') {
      // Stripe cancel_url → /upgrade?checkout=cancelled&plan=<plan>
      const context = takeCheckout(params.get('plan'));
      if (context) {
        resolved = context.source;
        analytics.track(
          AnalyticsEvents.purchaseCancelled({
            source: context.source,
            store: 'stripe',
            plan: context.plan,
            product_id: webProductId(context.plan),
          })
        );
      }
      params.delete('checkout');
      params.delete('plan');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
    setSource(resolved);
  }, []);

  const pricingVisible = !isLoading && entitlements?.subscriptionsEnabled === true && source !== null;
  useTrackOnce(source ? AnalyticsEvents.pricingViewed({ source }) : null, pricingVisible);
  useTrackOnce(source ? AnalyticsEvents.paywallViewed({ source }) : null, pricingVisible && !isPro);

  // Master feature flag: the subscription surface is invisible until enabled.
  if (!isLoading && entitlements?.subscriptionsEnabled !== true) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <Navbar />
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <Crown className="mx-auto h-8 w-8 text-amber-400" />
          <h1 className="mt-3 text-xl font-bold">FitCircle Pro is coming soon</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Everything in FitCircle is free right now. Enjoy!
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2">
            <Crown className="h-6 w-6 text-amber-400" />
            <h1 className="text-2xl font-bold">FitCircle Pro</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Unlimited AI food logging, unlimited Fitzy coaching, your full history, and an
            ad-free FitCircle — while your circles stay free for everyone.
          </p>
        </motion.div>

        {!isLoading && isPro ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
            <span className="mr-2 font-semibold">You're already Pro</span>
            <ProBadge />
            <p className="mt-1 text-muted-foreground">
              Manage your plan in Settings → Billing.
            </p>
          </div>
        ) : (
          <PricingCards source={source ?? 'pricing_page'} />
        )}

        <PlanComparison />
      </main>
    </div>
  );
}

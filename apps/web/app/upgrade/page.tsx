'use client';

/**
 * /upgrade — the FitCircle Pro pricing page (web paywall).
 * Annual pre-selected; checkout runs through Stripe (POST /api/billing/checkout);
 * entitlement lands via RevenueCat → backend webhook → profiles.
 */

import { motion } from 'framer-motion';
import { BanIcon, Crown, LineChart, Sparkles, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PricingCards, PlanComparison } from '@/components/billing/PricingCards';
import { ProBadge } from '@/components/billing/ProBadge';
import { Navbar } from '@/components/layout/navbar';
import { GlassCard, Screen, ToneDisc, type Tone } from '@/components/ui/ios';
import { useEntitlements } from '@/hooks/useEntitlements';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { paywallSource, takeCheckout, webProductId } from '@/lib/analytics/checkout';
import { useTrackOnce } from '@/lib/analytics/react';

/** iOS paywall feature list (PaywallView): what Pro adds, matching PlanComparison. */
const PRO_FEATURES: Array<{ icon: typeof Sparkles; tone: Tone; title: string; body: string }> = [
  { icon: Sparkles, tone: 'purple', title: 'Unlimited AI logging', body: 'Photo and voice logging plus Fitzy coach (fair-use limits apply).' },
  { icon: LineChart, tone: 'cyan', title: 'Your full history', body: 'Trends and progress beyond the free 14-day window.' },
  { icon: Users, tone: 'green', title: 'Unlimited circles', body: 'Create as many active circles as you want.' },
  { icon: BanIcon, tone: 'orange', title: 'No ads', body: 'A completely ad-free FitCircle.' },
];

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
      <div className="min-h-screen bg-canvas bg-hero-glow">
        <Navbar />
        <Screen className="py-16 text-center">
          <ToneDisc icon={Crown} tone="yellow" size="lg" className="mx-auto" />
          <h1 className="mt-4 text-title2 text-white">FitCircle Pro is coming soon</h1>
          <p className="mt-2 text-subhead text-fg-secondary">
            Everything in FitCircle is free right now. Enjoy!
          </p>
        </Screen>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
      <Navbar />
      <Screen className="space-y-6">
        <motion.header
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="pt-2 text-center"
          data-testid="paywall-header"
        >
          <p className="inline-flex items-center gap-1.5 text-footnote font-bold uppercase tracking-[0.18em] text-brand-orange">
            <Crown className="h-4 w-4" aria-hidden /> FitCircle Pro
          </p>
          <h1 className="mt-2 text-title1 text-white sm:text-large-title">Unlock FitCircle Pro</h1>
          <p className="mx-auto mt-2 max-w-md text-subhead text-fg-secondary">
            AI food logging and Fitzy coaching (fair-use limits apply), your full history, and an
            ad-free FitCircle, while your circles stay free for everyone.
          </p>
        </motion.header>

        <GlassCard as="div" className="space-y-4" data-testid="paywall-features">
          {PRO_FEATURES.map((f) => (
            <div key={f.title} className="flex items-start gap-3">
              <ToneDisc icon={f.icon} tone={f.tone} size="md" />
              <div className="min-w-0">
                <p className="text-headline text-white">{f.title}</p>
                <p className="text-footnote text-fg-secondary">{f.body}</p>
              </div>
            </div>
          ))}
        </GlassCard>

        {!isLoading && isPro ? (
          <GlassCard as="div" className="border-brand-yellow/30 bg-brand-yellow/10">
            <p className="flex items-center gap-2 text-headline text-white">
              You&apos;re already Pro <ProBadge />
            </p>
            <p className="mt-1 text-subhead text-fg-secondary">
              Manage your plan in{' '}
              <Link href="/settings/billing" className="font-semibold text-brand-purple hover:underline">
                Settings → Billing
              </Link>
              .
            </p>
          </GlassCard>
        ) : (
          <PricingCards source={source ?? 'pricing_page'} />
        )}

        <section>
          <h2 className="mb-2 px-4 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">Free vs Pro</h2>
          <PlanComparison />
        </section>
      </Screen>
    </div>
  );
}

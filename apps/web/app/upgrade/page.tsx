'use client';

/**
 * /upgrade — the FitCircle Pro pricing page (web paywall).
 * Annual pre-selected; checkout runs through Stripe (POST /api/billing/checkout);
 * entitlement lands via RevenueCat → backend webhook → profiles.
 */

import { motion } from 'framer-motion';
import { Crown } from 'lucide-react';

import { Navbar } from '@/components/layout/navbar';
import { PricingCards, PlanComparison } from '@/components/billing/PricingCards';
import { ProBadge } from '@/components/billing/ProBadge';
import { useEntitlements } from '@/hooks/useEntitlements';

export default function UpgradePage() {
  const { entitlements, isPro, isLoading } = useEntitlements();

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
          <PricingCards />
        )}

        <PlanComparison />
      </main>
    </div>
  );
}

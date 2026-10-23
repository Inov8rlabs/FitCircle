'use client';

/**
 * /upgrade/success — post-checkout landing. The entitlement arrives via
 * Stripe webhook → RevenueCat → our webhook → profiles, which can take a few
 * seconds; poll /api/entitlements until the tier flips (max ~30s), then celebrate.
 */

import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Navbar } from '@/components/layout/navbar';
import { GlassCard } from '@/components/ui/ios';
import { useEntitlements } from '@/hooks/useEntitlements';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { firstTimeFor, takeCheckout, webProductId } from '@/lib/analytics/checkout';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

export default function UpgradeSuccessPage() {
  const { refresh } = useEntitlements();
  const [state, setState] = useState<'activating' | 'active' | 'slow'>('activating');
  const attempts = useRef(0);

  // Stripe only redirects to success_url after a successful payment, so the
  // purchase is complete on arrival (entitlement sync can lag; see polling below).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const context = takeCheckout(params.get('plan'));
    if (!context || !firstTimeFor(sessionId)) return;
    analytics.track(
      AnalyticsEvents.purchaseCompleted({
        source: context.source,
        plan: context.plan,
        product_id: webProductId(context.plan),
        store: 'stripe',
      })
    );
    analytics.setUserProperties({ plan: 'pro', pro_plan: context.plan });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      while (!cancelled && attempts.current < POLL_MAX_ATTEMPTS) {
        attempts.current += 1;
        const data = await refresh();
        if (data?.tier === 'premium') {
          if (!cancelled) setState('active');
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
      if (!cancelled) setState('slow');
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  return (
    <div className="min-h-screen bg-canvas bg-hero-glow">
      <Navbar />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        <GlassCard as="div" className="flex w-full flex-col items-center px-6 py-10">
        {state === 'activating' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-brand-purple" />
            <h1 className="mt-4 text-title3 text-white">Activating your Pro membership…</h1>
            <p className="mt-2 text-subhead text-fg-secondary">
              Payment received — syncing your account. This usually takes a few seconds.
            </p>
          </>
        )}
        {state === 'active' && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-green/20"><CheckCircle2 className="h-9 w-9 text-brand-green" /></span>
            <h1 className="mt-4 text-title2 text-white">Welcome to Pro 🎉</h1>
            <p className="mt-2 text-subhead text-fg-secondary">
              AI logging and Fitzy (fair-use limits apply), your full history and no ads,
              everywhere you use FitCircle, including the mobile apps.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex h-12 items-center rounded-xl bg-gradient-brand px-6 text-headline text-white shadow-glow transition hover:brightness-110"
            >
              Back to my dashboard
            </Link>
          </motion.div>
        )}
        {state === 'slow' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-brand-green" />
            <h1 className="mt-4 text-title3 text-white">Payment received</h1>
            <p className="mt-2 text-subhead text-fg-secondary">
              Your Pro membership is still syncing — it will appear on your account within a
              few minutes. If it doesn&apos;t, contact support and we&apos;ll sort it out.
            </p>
            <Link href="/dashboard" className="mt-6 text-subhead font-semibold text-brand-purple underline">
              Back to my dashboard
            </Link>
          </>
        )}
        </GlassCard>
      </main>
    </div>
  );
}

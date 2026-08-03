'use client';

/**
 * /upgrade/success — post-checkout landing. The entitlement arrives via
 * Stripe webhook → RevenueCat → our webhook → profiles, which can take a few
 * seconds; poll /api/entitlements until the tier flips (max ~30s), then celebrate.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';

import { Navbar } from '@/components/layout/navbar';
import { useEntitlements } from '@/hooks/useEntitlements';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 15;

export default function UpgradeSuccessPage() {
  const { refresh } = useEntitlements();
  const [state, setState] = useState<'activating' | 'active' | 'slow'>('activating');
  const attempts = useRef(0);

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
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
        {state === 'activating' && (
          <>
            <Loader2 className="h-10 w-10 animate-spin text-purple-400" />
            <h1 className="mt-4 text-xl font-bold">Activating your Pro membership…</h1>
            <p className="mt-2 text-sm text-muted-foreground">
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
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <h1 className="mt-4 text-2xl font-bold">Welcome to Pro 🎉</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Unlimited AI logging, unlimited Fitzy, full history, and no ads — everywhere
              you use FitCircle, including the mobile apps.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 rounded-xl bg-purple-500 px-6 py-3 font-bold text-white hover:bg-purple-600"
            >
              Back to my dashboard
            </Link>
          </motion.div>
        )}
        {state === 'slow' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-emerald-400" />
            <h1 className="mt-4 text-xl font-bold">Payment received</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your Pro membership is still syncing — it will appear on your account within a
              few minutes. If it doesn't, contact support and we'll sort it out.
            </p>
            <Link href="/dashboard" className="mt-6 text-sm font-semibold text-purple-400 underline">
              Back to my dashboard
            </Link>
          </>
        )}
      </main>
    </div>
  );
}

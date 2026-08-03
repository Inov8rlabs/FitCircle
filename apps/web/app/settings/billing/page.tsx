'use client';

/**
 * Settings → Billing — current plan, status, and management.
 * Stripe subscribers manage via the Stripe Billing Portal; App Store / Play
 * subscribers are pointed at their store (cross-platform subscriptions are
 * managed where they were purchased).
 */

import { useState } from 'react';
import { AlertTriangle, Crown, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { Card, CardContent } from '@/components/ui/card';
import { ProBadge } from '@/components/billing/ProBadge';
import { useEntitlements } from '@/hooks/useEntitlements';

const PLATFORM_LABELS: Record<string, string> = {
  app_store: 'the App Store',
  play_store: 'Google Play',
  stripe: 'FitCircle web',
  promotional: 'a promotion',
};

export default function BillingSettingsPage() {
  const { entitlements, isPro, isLoading } = useEntitlements();
  const [portalBusy, setPortalBusy] = useState(false);

  const sub = entitlements?.subscription;
  const platform = sub?.platform ?? null;
  const expiresAt = sub?.expiresAt ? new Date(sub.expiresAt) : null;
  const isTrialing = sub?.status === 'trialing';
  const isPastDue = sub?.status === 'past_due';
  const isLifetime = isPro && !expiresAt;

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const body = await res.json();
      if (body?.url) {
        window.location.assign(body.url);
        return;
      }
      if (body?.platform && body.platform !== 'stripe') {
        toast.info(`Manage your subscription in ${PLATFORM_LABELS[body.platform] ?? 'your app store'}.`);
        return;
      }
      toast.error('Could not open billing management.');
    } catch {
      toast.error('Could not open billing management.');
    } finally {
      setPortalBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <h1 className="text-2xl font-bold">Billing</h1>

        <Card>
          <CardContent className="p-4 space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading your plan…</p>
            ) : isPro ? (
              <>
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-amber-400" />
                  <p className="font-semibold">FitCircle Pro</p>
                  <ProBadge />
                </div>
                <p className="text-sm text-muted-foreground">
                  {isLifetime
                    ? 'Lifetime membership — yours forever.'
                    : isTrialing
                      ? `Free trial${expiresAt ? ` — converts ${expiresAt.toLocaleDateString()}` : ''}.`
                      : sub?.willRenew
                        ? `Renews ${expiresAt ? expiresAt.toLocaleDateString() : 'automatically'}.`
                        : `Active until ${expiresAt ? expiresAt.toLocaleDateString() : 'the end of the period'} — will not renew.`}
                  {platform ? ` Purchased via ${PLATFORM_LABELS[platform] ?? platform}.` : ''}
                </p>

                {isPastDue && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <p>
                      We couldn't collect your last payment. Update your payment method to keep
                      Pro — access pauses when the grace period ends.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={openPortal}
                  disabled={portalBusy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 py-2.5 text-sm font-semibold hover:bg-zinc-700 disabled:opacity-60"
                >
                  {platform === 'stripe' || platform == null
                    ? 'Manage subscription'
                    : `Manage in ${PLATFORM_LABELS[platform] ?? 'your store'}`}
                  <ExternalLink className="h-4 w-4" />
                </button>
              </>
            ) : entitlements?.subscriptionsEnabled === true ? (
              <>
                <p className="font-semibold">Free plan</p>
                <p className="text-sm text-muted-foreground">
                  You're on the free plan — 5 AI scans and 5 Fitzy messages a day, 14 days of
                  history, and up to 2 circles of your own.
                </p>
                <Link
                  href="/upgrade"
                  className="block w-full rounded-lg bg-purple-500 py-2.5 text-center text-sm font-bold text-white hover:bg-purple-600"
                >
                  Start your free week of Pro
                </Link>
              </>
            ) : (
              <>
                <p className="font-semibold">Free plan</p>
                <p className="text-sm text-muted-foreground">
                  Everything in FitCircle is currently free — nothing to manage here.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Subscriptions purchased on iOS or Android are billed by Apple or Google and must be
          cancelled there. Web subscriptions are billed by Stripe and managed here.
        </p>
      </main>
    </div>
  );
}

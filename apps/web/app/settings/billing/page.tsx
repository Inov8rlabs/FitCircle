'use client';

/**
 * Settings → Billing — current plan, status, and management.
 * Stripe subscribers manage via the Stripe Billing Portal; App Store / Play
 * subscribers are pointed at their store (cross-platform subscriptions are
 * managed where they were purchased).
 */

import { AlertTriangle, Crown, ExternalLink, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';

import { ProBadge } from '@/components/billing/ProBadge';
import { SettingsScreen } from '@/components/profile/settings-shell';
import { GlassCard, ListGroup, ListRow, ToneDisc } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { useEntitlements } from '@/hooks/useEntitlements';
import { AnalyticsEvents, analytics } from '@/lib/analytics';

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
        analytics.track(AnalyticsEvents.subscriptionManaged());
        window.location.assign(body.url);
        return;
      }
      if (body?.platform && body.platform !== 'stripe') {
        analytics.track(AnalyticsEvents.subscriptionManaged());
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

  const manageLabel =
    platform === 'stripe' || platform == null
      ? 'Manage subscription'
      : `Manage in ${PLATFORM_LABELS[platform] ?? 'your store'}`;

  return (
    <SettingsScreen title="Billing" subtitle="Your FitCircle plan">
      {isLoading ? (
        <Skeleton className="mb-6 h-[132px] rounded-xl" />
      ) : isPro ? (
        <>
          <GlassCard className="mb-6" data-testid="billing-plan-card">
            <div className="flex items-center gap-3">
              <ToneDisc icon={Crown} tone="yellow" size="lg" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-headline text-white">
                  FitCircle Pro <ProBadge />
                </p>
                <p className="mt-1 text-subhead text-fg-secondary">
                  {isLifetime
                    ? 'Lifetime membership — yours forever.'
                    : isTrialing
                      ? `Free trial${expiresAt ? ` — converts ${expiresAt.toLocaleDateString()}` : ''}.`
                      : sub?.willRenew
                        ? `Renews ${expiresAt ? expiresAt.toLocaleDateString() : 'automatically'}.`
                        : `Active until ${expiresAt ? expiresAt.toLocaleDateString() : 'the end of the period'} — will not renew.`}
                  {platform ? ` Purchased via ${PLATFORM_LABELS[platform] ?? platform}.` : ''}
                </p>
              </div>
            </div>

            {isPastDue && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-brand-yellow/40 bg-brand-yellow/10 px-3 py-2 text-subhead text-white">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-yellow" />
                <p>
                  We couldn&apos;t collect your last payment. Update your payment method to keep
                  Pro — access pauses when the grace period ends.
                </p>
              </div>
            )}
          </GlassCard>

          <ListGroup>
            <ListRow
              onClick={() => void openPortal()}
              icon={ExternalLink}
              tone="purple"
              title={portalBusy ? 'Opening…' : manageLabel}
              testId="billing-manage"
            />
          </ListGroup>
        </>
      ) : entitlements?.subscriptionsEnabled === true ? (
        <GlassCard className="mb-6" data-testid="billing-plan-card">
          <div className="flex items-center gap-3">
            <ToneDisc icon={Sparkles} tone="purple" size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-headline text-white">Free plan</p>
              <p className="mt-1 text-subhead text-fg-secondary">
                You&apos;re on the free plan — 5 AI scans and 5 Fitzy messages a day, 14 days of
                history, and up to 2 circles of your own.
              </p>
            </div>
          </div>
          <Link
            href="/upgrade?source=settings"
            className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-gradient-brand text-headline text-white shadow-glow transition hover:brightness-110"
          >
            Upgrade to Pro
          </Link>
        </GlassCard>
      ) : (
        <GlassCard className="mb-6" data-testid="billing-plan-card">
          <p className="text-headline text-white">Free plan</p>
          <p className="mt-1 text-subhead text-fg-secondary">
            Everything in FitCircle is currently free — nothing to manage here.
          </p>
        </GlassCard>
      )}

      <p className="px-4 text-footnote text-fg-tertiary">
        Subscriptions purchased on iOS or Android are billed by Apple or Google and must be
        cancelled there. Web subscriptions are billed by Stripe and managed here.
      </p>
    </SettingsScreen>
  );
}

'use client';

import { motion } from 'framer-motion';
import { Check, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AnalyticsEvents, analytics, toErrorKind, type Plan } from '@/lib/analytics';
import { rememberCheckout, webProductId } from '@/lib/analytics/checkout';

const PRICE_MONTHLY = 9.99;
const PRICE_ANNUAL = 29.99;
const PRICE_LIFETIME = 179.99;

/**
 * Launch promo display: set NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL (e.g. "39.99") to
 * show the strikethrough first-year price. The actual discount is applied
 * server-side via STRIPE_COUPON_LAUNCH — this is presentation only.
 */
const PROMO_ANNUAL = Number(process.env.NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL ?? '') || null;
const SHOW_LIFETIME = process.env.NEXT_PUBLIC_LIFETIME_OFFER === 'true';

export function PricingCards({ source = 'pricing_page' }: { source?: string }) {
  const [selected, setSelected] = useState<Plan>('annual'); // annual pre-selected
  const [busy, setBusy] = useState(false);

  const selectPlan = (plan: Plan) => {
    setSelected(plan);
    analytics.track(AnalyticsEvents.paywallPlanSelected({ source, plan, product_id: webProductId(plan) }));
  };

  const startCheckout = async () => {
    setBusy(true);
    const plan = selected;
    const product_id = webProductId(plan);
    analytics.track(AnalyticsEvents.purchaseStarted({ source, plan, product_id, store: 'stripe' }));
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json();
      if (res.status === 409) {
        analytics.track(
          AnalyticsEvents.purchaseFailed({ source, plan, product_id, store: 'stripe', error_kind: 'validation' })
        );
        toast.info(body?.message ?? 'You already have FitCircle Pro.');
        return;
      }
      if (!res.ok || !body?.url) {
        analytics.track(
          AnalyticsEvents.purchaseFailed({
            source,
            plan,
            product_id,
            store: 'stripe',
            error_kind: toErrorKind(null, res.ok ? 500 : res.status),
          })
        );
        toast.error('Could not start checkout — please try again.');
        return;
      }
      // The Stripe return pages read this back to report Completed / Cancelled with the source.
      rememberCheckout({ plan, source });
      window.location.assign(body.url);
    } catch (error) {
      analytics.track(
        AnalyticsEvents.purchaseFailed({ source, plan, product_id, store: 'stripe', error_kind: toErrorKind(error) })
      );
      toast.error('Could not start checkout — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const annualPerMonth = ((PROMO_ANNUAL ?? PRICE_ANNUAL) / 12).toFixed(2);

  const planCard = (
    plan: Plan,
    title: string,
    price: React.ReactNode,
    caption: string,
    badge?: string
  ) => {
    const isSelected = selected === plan;
    return (
      <button
        type="button"
        onClick={() => selectPlan(plan)}
        aria-pressed={isSelected}
        data-testid={`plan-${plan}`}
        className={`relative flex w-full items-center gap-3 rounded-xl border-2 p-4 text-left transition duration-200 ease-ios ${
          isSelected
            ? 'border-brand-purple bg-brand-purple/10 shadow-glow'
            : 'border-glass bg-surface-raised/50 hover:border-white/20'
        }`}
      >
        {/* iOS radio: filled check disc when selected, ring when not */}
        <span
          aria-hidden
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            isSelected ? 'bg-brand-purple text-white' : 'border-2 border-white/25'
          }`}
        >
          {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-headline text-white">{title}</span>
            {badge && (
              <span className="rounded-full bg-gradient-brand px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-footnote text-fg-secondary">{caption}</span>
        </span>
        <span className="shrink-0 text-right text-headline text-white">{price}</span>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {planCard(
        'annual',
        'Annual',
        <p className="font-bold tabular-nums">
          {PROMO_ANNUAL !== null && (
            <span className="mr-2 text-subhead font-medium text-fg-tertiary line-through">
              ${PRICE_ANNUAL}
            </span>
          )}
          ${PROMO_ANNUAL ?? PRICE_ANNUAL}
          <span className="text-footnote font-medium text-fg-secondary">/yr</span>
        </p>,
        PROMO_ANNUAL !== null
          ? `Launch offer — $${annualPerMonth}/mo billed yearly for your first year, then $${PRICE_ANNUAL}/yr.`
          : `$${annualPerMonth}/mo, billed yearly. Renews automatically; cancel any time to stop the next renewal.`,
        'BEST VALUE'
      )}
      {planCard(
        'monthly',
        'Monthly',
        <p className="font-bold tabular-nums">
          ${PRICE_MONTHLY}
          <span className="text-footnote font-medium text-fg-secondary">/mo</span>
        </p>,
        'Billed monthly. Renews automatically; cancel any time to stop the next renewal.'
      )}
      {SHOW_LIFETIME &&
        planCard(
          'lifetime',
          'Lifetime',
          <p className="font-bold tabular-nums">${PRICE_LIFETIME}</p>,
          'One-time payment, Pro forever. Launch-window only.',
          'LIMITED'
        )}

      <motion.button
        whileTap={{ scale: 0.98 }}
        type="button"
        disabled={busy}
        onClick={startCheckout}
        data-testid="checkout-button"
        className="h-14 w-full rounded-xl bg-gradient-brand text-headline text-white shadow-glow transition hover:brightness-110 disabled:opacity-60"
      >
        {busy ? 'Opening checkout…' : selected === 'lifetime' ? 'Get Pro forever' : 'Continue to checkout'}
      </motion.button>
      <p className="text-center text-caption leading-relaxed text-fg-tertiary">
        Subscriptions renew automatically. Cancel any time in Settings → Billing to stop the next
        renewal; you keep Pro until the end of the period you&apos;ve paid for. No refunds for partial
        periods.{' '}
        <a href="/terms" className="underline">Terms</a> ·{' '}
        <a href="/privacy" className="underline">Privacy</a>
      </p>
    </div>
  );
}

/** Free vs Pro comparison rows (MONETIZATION-PLAN gating matrix). */
export function PlanComparison() {
  const rows: Array<[string, string, string]> = [
    ['AI food logging', '5 scans/day', 'Fair-use limits'],
    ['Fitzy AI coach', '5 messages/day', 'Fair-use limits + weekly plan'],
    ['Body composition', 'Logging', 'Photo scan, trends, coach'],
    ['History & analytics', 'Last 14 days', 'Full history'],
    ['Circles', 'Join unlimited · create 2', 'Create unlimited'],
    ['Streak shields', 'Earn with XP', 'Unlimited'],
    ['Ads', 'Shown', 'Ad-free'],
    ['Style', '—', 'Pro badge + custom share themes'],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-glass bg-surface-raised/50" data-testid="plan-comparison">
      <div>
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-2 border-b border-white/[0.06] px-4 py-3 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">
          <span>Feature</span>
          <span>Free</span>
          <span className="flex items-center gap-1 text-brand-purple">
            <Sparkles className="h-3 w-3" /> Pro
          </span>
        </div>
        <div className="divide-y divide-white/[0.06] text-subhead">
          {rows.map(([feature, free, pro]) => (
            <div key={feature} className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-2 px-4 py-2.5">
              <span className="font-medium text-white">{feature}</span>
              <span className="text-fg-secondary">{free}</span>
              <span className="flex items-start gap-1 text-white">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-purple" />
                {pro}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

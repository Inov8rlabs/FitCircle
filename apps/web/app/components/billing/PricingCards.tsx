'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';

type Plan = 'monthly' | 'annual' | 'lifetime';

const PRICE_MONTHLY = 9.99;
const PRICE_ANNUAL = 59.99;
const PRICE_LIFETIME = 149.99;

/**
 * Launch promo display: set NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL (e.g. "39.99") to
 * show the strikethrough first-year price. The actual discount is applied
 * server-side via STRIPE_COUPON_LAUNCH — this is presentation only.
 */
const PROMO_ANNUAL = Number(process.env.NEXT_PUBLIC_LAUNCH_PROMO_ANNUAL ?? '') || null;
const SHOW_LIFETIME = process.env.NEXT_PUBLIC_LIFETIME_OFFER === 'true';

export function PricingCards() {
  const [selected, setSelected] = useState<Plan>('annual'); // annual pre-selected
  const [busy, setBusy] = useState(false);

  const startCheckout = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selected }),
      });
      const body = await res.json();
      if (res.status === 409) {
        toast.info(body?.message ?? 'You already have FitCircle Pro.');
        return;
      }
      if (!res.ok || !body?.url) {
        toast.error('Could not start checkout — please try again.');
        return;
      }
      window.location.assign(body.url);
    } catch {
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
  ) => (
    <button
      type="button"
      onClick={() => setSelected(plan)}
      aria-pressed={selected === plan}
      className={`relative w-full rounded-xl border p-4 text-left transition-colors ${
        selected === plan
          ? 'border-purple-500 bg-purple-500/10'
          : 'border-border bg-zinc-900/40 hover:border-zinc-600'
      }`}
    >
      {badge && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-purple-500 px-2 py-0.5 text-[11px] font-bold text-white">
          {badge}
        </span>
      )}
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">{title}</p>
        <div className="text-right">{price}</div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
    </button>
  );

  return (
    <div className="space-y-3">
      {planCard(
        'annual',
        'Annual',
        <p className="font-bold">
          {PROMO_ANNUAL !== null && (
            <span className="mr-2 text-sm font-medium text-muted-foreground line-through">
              ${PRICE_ANNUAL}
            </span>
          )}
          ${PROMO_ANNUAL ?? PRICE_ANNUAL}
          <span className="text-xs font-medium text-muted-foreground">/yr</span>
        </p>,
        PROMO_ANNUAL !== null
          ? `Launch offer — $${annualPerMonth}/mo billed yearly for your first year, then $${PRICE_ANNUAL}/yr. 7 days free first.`
          : `$${annualPerMonth}/mo billed yearly. 7 days free first.`,
        'BEST VALUE'
      )}
      {planCard(
        'monthly',
        'Monthly',
        <p className="font-bold">
          ${PRICE_MONTHLY}
          <span className="text-xs font-medium text-muted-foreground">/mo</span>
        </p>,
        '7 days free, then billed monthly. Cancel anytime.'
      )}
      {SHOW_LIFETIME &&
        planCard(
          'lifetime',
          'Lifetime',
          <p className="font-bold">${PRICE_LIFETIME}</p>,
          'One-time payment, Pro forever. Launch-window only.',
          'LIMITED'
        )}

      <motion.button
        whileTap={{ scale: 0.98 }}
        type="button"
        disabled={busy}
        onClick={startCheckout}
        className="w-full rounded-xl bg-purple-500 py-3.5 font-bold text-white transition-colors hover:bg-purple-600 disabled:opacity-60"
      >
        {busy ? 'Opening checkout…' : selected === 'lifetime' ? 'Get Pro forever' : 'Start my free week'}
      </motion.button>
      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Subscriptions renew automatically until cancelled. Manage or cancel anytime in
        Settings → Billing.{' '}
        <a href="/terms" className="underline">Terms</a> ·{' '}
        <a href="/privacy" className="underline">Privacy</a>
      </p>
    </div>
  );
}

/** Free vs Pro comparison rows (MONETIZATION-PLAN gating matrix). */
export function PlanComparison() {
  const rows: Array<[string, string, string]> = [
    ['AI food logging', '5 scans/day', 'Unlimited'],
    ['Fitzy AI coach', '5 messages/day', 'Unlimited + weekly insights'],
    ['Body composition', 'Logging', 'Photo scan, trends, coach'],
    ['History & analytics', 'Last 14 days', 'Unlimited + export'],
    ['Circles', 'Join unlimited · create 2', 'Create unlimited'],
    ['Streak shields', 'Earn with XP', 'Bonus shields'],
    ['Ads', 'Shown', 'Ad-free'],
    ['Style', '—', 'Pro badge + custom share themes'],
  ];
  return (
    <Card>
      <CardContent className="p-0">
        <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Feature</span>
          <span>Free</span>
          <span className="flex items-center gap-1 text-purple-400">
            <Sparkles className="h-3 w-3" /> Pro
          </span>
        </div>
        <div className="divide-y divide-border text-sm">
          {rows.map(([feature, free, pro]) => (
            <div key={feature} className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-2 px-4 py-2.5">
              <span className="font-medium">{feature}</span>
              <span className="text-muted-foreground">{free}</span>
              <span className="flex items-start gap-1 text-foreground">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-400" />
                {pro}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

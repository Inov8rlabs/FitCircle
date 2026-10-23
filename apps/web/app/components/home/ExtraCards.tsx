'use client';

/**
 * Smaller home-feed cards: Fitzy daily focus, "Better together" referral,
 * Pro upsell and the past-date log row. Each self-gates (renders nothing when
 * it has nothing to show), like the iOS cards.
 */
import { CalendarPlus, ChevronRight, Crown, Gift, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { GlassCard, ToneDisc } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import type { ReferralHub } from '@/lib/referrals/types';
import type { FitzyAction, FitzyDailyFocus } from '@/lib/types/fitzy';

async function getData<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store', ...init });
    if (!res.ok) return null;
    const body = await res.json();
    return (body?.data ?? null) as T | null;
  } catch {
    return null;
  }
}

function hrefFor(action: FitzyAction): string | null {
  switch (action.type) {
    case 'log_meal':
      return '/food-log/new';
    case 'log_workout':
      return '/exercise-log/new';
    case 'invite_buddy':
      return '/invite';
    case 'open_circle':
      return action.payload?.circleId ? `/fitcircles/${action.payload.circleId}` : '/fitcircles';
    default:
      return null;
  }
}

/** Fitzy's daily focus (GET /api/mobile/fitzy/today). Fixed-height skeleton while it loads. */
export function FitzyFocusCard() {
  const [focus, setFocus] = useState<FitzyDailyFocus | null | undefined>(undefined);
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void getData<FitzyDailyFocus>('/api/mobile/fitzy/today', { headers: tz ? { 'x-client-timezone': tz } : {} }).then(setFocus);
  }, []);
  if (focus === undefined) {
    return (
      <GlassCard aria-busy="true" data-testid="fitzy-focus-skeleton">
        <div className="flex gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </GlassCard>
    );
  }
  if (!focus?.headline) return null;
  const href = hrefFor(focus.cta.action);
  return (
    <GlassCard data-testid="fitzy-focus-card" className="border-brand-purple/25 bg-gradient-to-br from-brand-purple/15 via-surface-raised/50 to-brand-pink/10">
      <div className="flex gap-3">
        <ToneDisc icon={Sparkles} tone="pink" />
        <div className="min-w-0 flex-1">
          <p className="text-caption font-semibold uppercase tracking-wide text-brand-pink">Fitzy · Today&apos;s focus</p>
          <h2 className="mt-0.5 text-headline text-white">{focus.headline}</h2>
          <p className="mt-1 text-subhead text-fg-secondary">{focus.body}</p>
          {href && (
            <Button asChild size="sm" className="mt-3">
              <Link href={href}>{focus.cta.label}</Link>
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

/** "Better together" referral card (GET /api/mobile/referrals). Hidden while the program is off. */
export function ReferralHomeCard() {
  const [hub, setHub] = useState<ReferralHub | null>(null);
  useEffect(() => {
    void getData<ReferralHub>('/api/mobile/referrals').then(setHub);
  }, []);
  if (!hub?.enabled) return null;
  const days = hub.program?.rewardDaysPerFriend;
  return (
    <Link href="/invite" className="block rounded-xl" data-testid="referral-home-card">
      <GlassCard className="flex items-center gap-4 border-brand-pink/25 bg-gradient-to-r from-brand-pink/15 to-brand-purple/10 transition hover:border-brand-pink/40">
        <ToneDisc icon={Gift} tone="pink" size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-headline text-white">Better together</h2>
          <p className="text-subhead text-fg-secondary">
            {days ? `Earn ${days} days of Pro for every friend who sticks with it.` : 'Invite a friend and keep each other going.'}
          </p>
          {hub.stats && hub.stats.invited > 0 && (
            <p className="mt-1 text-caption text-brand-pink">
              {hub.stats.qualified} of {hub.stats.invited} friends qualified
            </p>
          )}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-fg-tertiary" aria-hidden />
      </GlassCard>
    </Link>
  );
}

/** Pro value-prop for free users (iOS ProUpsellCard). */
export function ProUpsellCard({ isPro, loading }: { isPro: boolean; loading: boolean }) {
  if (loading || isPro) return null;
  return (
    <Link href="/upgrade" className="block rounded-xl" data-testid="pro-upsell-card">
      <GlassCard className="flex items-center gap-4 border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-brand-purple/10 transition hover:border-amber-500/40">
        <ToneDisc icon={Crown} tone="yellow" size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-headline text-white">FitCircle Pro</h2>
          <p className="text-subhead text-fg-secondary">More AI logging, your full history and no ads.</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-fg-tertiary" aria-hidden />
      </GlassCard>
    </Link>
  );
}

/** "Log Data for Past Date" row (indigo tint, iOS). */
export function PastDateRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="past-date-row"
      className="flex w-full items-center gap-3 rounded-xl bg-brand-indigo/10 px-4 py-3.5 text-left text-brand-indigo transition hover:bg-brand-indigo/15"
    >
      <CalendarPlus className="h-5 w-5" aria-hidden />
      <span className="flex-1 text-subhead font-semibold">Log Data for Past Date</span>
      <ChevronRight className="h-4 w-4" aria-hidden />
    </button>
  );
}

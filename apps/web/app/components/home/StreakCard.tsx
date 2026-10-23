'use client';

import { Flame, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { GlassCard } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { STREAK_AUTO_CLAIMED_EVENT } from '@/lib/streaks/auto-claim-events';
import { useAuthStore } from '@/stores/auth-store';

import { isoDay } from './useTracking';

interface EngagementStreak {
  current_streak: number;
  longest_streak: number;
  last_engagement_date: string | null;
  streak_freezes_available?: number;
}

/** GET /api/streaks/engagement (cookie auth), same source as the old streak card. */
export function useEngagementStreak() {
  const userId = useAuthStore((s) => s.user?.id);
  const [streak, setStreak] = useState<EngagementStreak | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/streaks/engagement', { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      setStreak((await res.json()) as EngagementStreak);
    } catch {
      setStreak({ current_streak: 0, longest_streak: 0, last_engagement_date: null });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!userId) return;
    void load();
    const onClaim = () => void load();
    window.addEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
  }, [userId, load]);
  return { streak, loading };
}

/**
 * iOS StreakClaimDashboardCard: orange flame disc with the count, "N days /
 * Current streak", "Tap to claim" until today counts. Opens the streak screen.
 */
export function StreakCard() {
  const { streak, loading } = useEngagementStreak();
  if (loading || !streak) {
    return (
      <GlassCard aria-busy="true" data-testid="streak-card-skeleton">
        <Skeleton className="mb-4 h-6 w-32" />
        <div className="flex items-center gap-5">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
      </GlassCard>
    );
  }
  const claimedToday = streak.last_engagement_date === isoDay();
  const n = streak.current_streak ?? 0;
  return (
    <Link href="/streaks" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange" data-testid="streak-card">
      <GlassCard className="transition duration-200 ease-ios hover:border-white/20">
        <h2 className="mb-4 text-title3 text-white">Daily Streak</h2>
        <div className="flex items-center gap-5">
          <div className="flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-full bg-gradient-orange text-white shadow-[0_10px_30px_-8px_rgba(249,115,22,0.7)]">
            <Flame className="h-8 w-8" fill="currentColor" aria-hidden />
            <span className="text-title3 font-bold tabular-nums">{n}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[28px] font-bold leading-tight text-white">
              {n} {n === 1 ? 'day' : 'days'}
            </p>
            <p className="text-subhead text-fg-secondary">Current streak</p>
            {!claimedToday ? (
              <p className="mt-1 text-subhead font-semibold text-brand-orange">Tap to claim</p>
            ) : (
              <p className="mt-1 text-subhead font-semibold text-brand-green">Today counts ✓</p>
            )}
            {streak.longest_streak > 0 && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-cyan/10 px-2.5 py-1 text-caption font-semibold text-brand-cyan">
                <Sparkles className="h-3 w-3" aria-hidden />
                Best streak: {streak.longest_streak} days
              </p>
            )}
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

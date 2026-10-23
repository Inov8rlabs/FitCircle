'use client';

/**
 * Daily Streak page — web port of iOS `StreakClaimContainerView` and Android
 * `StreakClaimScreen`. Composes:
 *
 *   - Hero card (current streak + claim button + best-streak badge)
 *   - Health data sync card (when applicable)
 *   - Retroactive claim strip (last 7 days as gradient pills)
 *   - Shield/freeze widget
 *   - Milestone grid (7 / 30 / 60 / 100 / 365)
 *   - Engagement history feed
 *   - Confetti overlay + milestone celebration modal
 */

import { motion, AnimatePresence } from 'framer-motion';
import {
  Flame, Sparkles, Shield, Check, X, RefreshCcw, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import Celebration from '@/components/Celebration';
import { Navbar } from '@/components/layout/navbar';
import { MilestoneBadge } from '@/components/streaks/MilestoneBadge';
import { Button } from '@/components/ui/button';
import { GlassCard, Screen, ScreenHeader, ToneDisc } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { useTrackOnce } from '@/lib/analytics/react';
import {
  type ClaimableDay,
  type ShieldStatus,
  type StreakEngagement,
  type EngagementHistoryEntry,
  streakClient,
} from '@/lib/api/streak-client';
import { MILESTONES as CANONICAL_MILESTONES } from '@/lib/streaks/streak-config';
import { useAuthStore } from '@/stores/auth-store';

// ─── Milestone metadata (single source: lib/streaks/streak-config) ──────────

const MILESTONES = CANONICAL_MILESTONES.map(m => ({
  days: m.days,
  title: m.name,
  badge: m.badge,
  message: m.description,
}));

type Milestone = (typeof MILESTONES)[number];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function StreaksPage() {
  const { user, isAuthenticated } = useAuthStore();
  const [engagement, setEngagement] = useState<StreakEngagement | null>(null);
  const [claimable, setClaimable] = useState<ClaimableDay[]>([]);
  const [shield, setShield] = useState<ShieldStatus | null>(null);
  const [history, setHistory] = useState<EngagementHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isClaiming, setIsClaiming] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [shieldDialogDate, setShieldDialogDate] = useState<string | null>(null);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const todayString = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const todayDay = claimable.find(d => d.date === todayString);
  const isTodayClaimed = todayDay?.claimed ?? false;
  const canClaimToday = todayDay?.canClaim ?? false;
  const healthDataSynced = todayDay?.hasHealthData ?? false;
  const currentStreak = engagement?.current_streak ?? 0;
  const longestStreak = engagement?.longest_streak ?? 0;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [eng, claim, sh, hist] = await Promise.allSettled([
        streakClient.getEngagement(),
        streakClient.getClaimableDays(timezone),
        streakClient.getShields(),
        streakClient.getHistory(30),
      ]);
      if (eng.status === 'fulfilled') setEngagement(eng.value);
      if (claim.status === 'fulfilled') setClaimable(claim.value.days);
      if (sh.status === 'fulfilled') setShield(sh.value);
      if (hist.status === 'fulfilled') setHistory(hist.value.entries);
    } catch (e) {
      console.warn('[streaks] load error', e);
    } finally {
      setIsLoading(false);
    }
  }, [user, timezone]);

  useEffect(() => { void load(); }, [load]);

  const claimToday = async () => {
    if (isClaiming || !canClaimToday) return;
    setIsClaiming(true);
    // Optimistic UI
    setEngagement(prev => prev ? { ...prev, current_streak: prev.current_streak + 1, longest_streak: Math.max(prev.longest_streak, prev.current_streak + 1) } : prev);
    setClaimable(prev => prev.map(d => d.date === todayString ? { ...d, claimed: true, canClaim: false } : d));
    setConfetti(true);

    try {
      const result = await streakClient.claimStreak(null, timezone);
      analytics.track(AnalyticsEvents.checkInCompleted({ is_backfill: false, streak_day: result.streakCount }));
      if (result.milestone) {
        analytics.track(AnalyticsEvents.streakMilestoneReached({ milestone: result.milestone.milestone }));
        const m = MILESTONES.find(m => m.days === result.milestone!.milestone) ?? null;
        setMilestone(m);
      }
      toast.success('Streak claimed! 🔥');
      await load();
    } catch (e: any) {
      // Roll back optimistic update if it wasn't an "already claimed" race
      if (!String(e?.message).match(/already.claimed/i)) {
        await load();
        toast.error(e?.message ?? 'Could not claim streak');
        setConfetti(false);
      }
    } finally {
      setIsClaiming(false);
      setTimeout(() => setConfetti(false), 2_500);
    }
  };

  const claimRetroactive = async (date: string) => {
    if (isClaiming) return;
    setIsClaiming(true);
    try {
      const result = await streakClient.claimStreak(date, timezone);
      analytics.track(AnalyticsEvents.checkInCompleted({ is_backfill: true, streak_day: result.streakCount }));
      if (result.milestone) {
        analytics.track(AnalyticsEvents.streakMilestoneReached({ milestone: result.milestone.milestone }));
      }
      toast.success(`Claimed ${formatDay(date)}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not claim');
    } finally {
      setIsClaiming(false);
    }
  };

  const activateShield = async (date: string) => {
    setShieldDialogDate(null);
    if (!shield?.can_activate && shield && shield.available <= 0) return;
    try {
      const result = await streakClient.activateFreeze(date, timezone);
      analytics.track(AnalyticsEvents.streakShieldUsed());
      toast.success(result.message ?? 'Shield activated');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not activate shield');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <p className="text-fg-secondary">Sign in to view your streak.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar />

      <Screen className="space-y-5">
        <ScreenHeader title="Daily Streak" subtitle="Shields cover the day you miss." className="mb-0" />
        {/* Hero */}
        <HeroCard
          currentStreak={currentStreak}
          longestStreak={longestStreak}
          isTodayClaimed={isTodayClaimed}
          canClaimToday={canClaimToday}
          isClaiming={isClaiming}
          isLoading={isLoading}
          subtitle={claimSubtitle({ isTodayClaimed, canClaimToday, healthDataSynced, reason: todayDay?.reason })}
          onClaim={claimToday}
        />

        {/* Health data warning */}
        {!isLoading && !healthDataSynced && !isTodayClaimed && (
          <HealthSyncCard />
        )}

        {/* Retroactive strip */}
        {claimable.length > 0 && (
          <RetroactivePanel
            days={claimable}
            isLoading={isClaiming}
            onClaim={claimRetroactive}
            onOfferShield={(date) => setShieldDialogDate(date)}
            onRefresh={() => { void load(); }}
          />
        )}

        {/* Shield widget */}
        {shield && <ShieldWidget shield={shield} onUseShield={() => {/* opens via retroactive */}} />}
        {!shield && isLoading && <Skeleton className="h-[72px] w-full rounded-xl" />}

        {/* Milestone grid */}
        <MilestoneGrid milestones={[...MILESTONES]} currentStreak={currentStreak} />

        {/* History */}
        {history.length > 0 && <HistoryFeed entries={history.slice(0, 21)} />}
      </Screen>

      {/* Confetti */}
      <AnimatePresence>
        {confetti && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <Celebration onComplete={() => setConfetti(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Milestone celebration */}
      <AnimatePresence>
        {milestone && (
          <MilestoneCelebration
            milestone={milestone}
            currentStreak={currentStreak}
            onDismiss={() => setMilestone(null)}
          />
        )}
      </AnimatePresence>

      {/* Shield dialog */}
      <AnimatePresence>
        {shieldDialogDate && shield && (
          <ShieldDialog
            available={shield.available}
            unlimited={shield.unlimited}
            date={shieldDialogDate}
            onConfirm={() => activateShield(shieldDialogDate)}
            onCancel={() => setShieldDialogDate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function HeroCard({
  currentStreak, longestStreak, isTodayClaimed, canClaimToday, isClaiming, isLoading, subtitle, onClaim,
}: {
  currentStreak: number;
  longestStreak: number;
  isTodayClaimed: boolean;
  canClaimToday: boolean;
  isClaiming: boolean;
  isLoading: boolean;
  subtitle: string;
  onClaim: () => void;
}) {
  return (
    <GlassCard className="p-5 sm:p-6" data-testid="streak-hero">
      <div className="space-y-1">
        <p className="text-subhead text-fg-secondary">Keep your streak alive</p>
        {isLoading ? (
          <Skeleton className="h-9 w-48" />
        ) : (
          <p className="text-title1 font-bold text-white">{currentStreak} day streak</p>
        )}
      </div>

      <div className="flex justify-center py-6">
        <button
          type="button"
          disabled={!canClaimToday || isClaiming || isLoading}
          onClick={onClaim}
          data-testid="streak-claim"
          aria-label={isTodayClaimed ? `${currentStreak} days, today claimed` : canClaimToday ? 'Claim today' : subtitle}
          className={`
            relative flex h-48 w-48 flex-col items-center justify-center rounded-full font-bold text-white
            transition duration-300 ease-ios
            ${isTodayClaimed
              ? 'bg-gradient-green shadow-[0_12px_40px_-8px_rgba(16,185,129,0.6)]'
              : canClaimToday
                ? 'bg-gradient-orange shadow-[0_12px_48px_-6px_rgba(249,115,22,0.75)] hover:scale-[1.03] active:scale-95'
                : 'bg-gradient-orange shadow-[0_12px_40px_-10px_rgba(249,115,22,0.5)] cursor-default'}
          `}
        >
          {isClaiming ? (
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" />
          ) : isTodayClaimed ? (
            <>
              <Check className="h-12 w-12" strokeWidth={3} />
              <span className="mt-1 text-[40px] leading-none">{currentStreak}</span>
              <span className="mt-1 text-footnote font-semibold">Claimed today</span>
            </>
          ) : (
            <>
              <Flame className="h-14 w-14 fill-white/90" />
              <span className="mt-1 text-[40px] leading-none">{currentStreak}</span>
              <span className="mt-1 line-clamp-2 px-6 text-center text-footnote font-semibold">{subtitle}</span>
            </>
          )}
        </button>
      </div>

      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-cyan/15 px-3.5 py-1.5 text-footnote font-semibold text-brand-cyan">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Best streak: {Math.max(longestStreak, currentStreak)} days
        </span>
      </div>
    </GlassCard>
  );
}

function HealthSyncCard() {
  return (
    <GlassCard className="flex items-start gap-3 border-brand-orange/30 bg-brand-orange/5">
      <ToneDisc icon={AlertTriangle} tone="orange" />
      <div className="flex-1">
        <p className="text-headline text-white">Health data missing</p>
        <p className="text-subhead text-fg-secondary">
          Log today&apos;s steps or weight to unlock streak claiming.
        </p>
      </div>
    </GlassCard>
  );
}

function RetroactivePanel({
  days, isLoading, onClaim, onOfferShield, onRefresh,
}: {
  days: ClaimableDay[];
  isLoading: boolean;
  onClaim: (date: string) => void;
  onOfferShield: (date: string) => void;
  onRefresh: () => void;
}) {
  return (
    <GlassCard data-testid="streak-last7">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-title3 text-white">Last 7 Days</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh claimable days"
          >
            <RefreshCcw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:grid-cols-7 sm:overflow-visible">
          {days.map((day) => (
            <DayPill
              key={day.date}
              day={day}
              onTap={() => {
                if (day.canClaim) onClaim(day.date);
                else if (!day.claimed) onOfferShield(day.date);
              }}
            />
          ))}
        </div>
    </GlassCard>
  );
}

function DayPill({ day, onTap }: { day: ClaimableDay; onTap: () => void }) {
  const date = new Date(`${day.date}T00:00:00`);
  const dayOfWeek = date.toLocaleDateString(undefined, { weekday: 'short' });
  const dayNumber = date.getDate();

  let bg = 'bg-white/10';
  let icon: React.ReactNode = '—';
  let canTap = false;
  if (day.isFrozen) {
    bg = 'bg-brand-indigo';
    icon = <Shield className="h-4 w-4 text-white" />;
  } else if (day.claimed) {
    bg = 'bg-brand-green/80';
    icon = <Check className="h-5 w-5 text-white" />;
  } else if (day.canClaim) {
    bg = 'bg-gradient-orange animate-pulse';
    icon = '🔥';
    canTap = true;
  } else {
    bg = 'bg-brand-red';
    icon = <X className="h-4 w-4 text-white" />;
    canTap = true; // tap opens shield dialog
  }

  return (
    <button
      type="button"
      disabled={day.claimed || day.isFrozen}
      onClick={onTap}
      className={`
        flex min-w-[64px] flex-col items-center gap-1 rounded-xl bg-white/[0.04] px-2 py-3
        ${canTap ? 'hover:bg-white/[0.08]' : ''} transition-colors
      `}
    >
      <div className={`h-12 w-12 rounded-full flex items-center justify-center text-xl shadow-lg ${bg}`}>
        {icon}
      </div>
      <span className="text-subhead font-bold text-white">{dayNumber}</span>
      <span className="text-caption font-semibold text-fg-tertiary">{dayOfWeek}</span>
      {day.hasHealthData && (
        <span className="text-[10px] font-medium text-brand-green">✓ Synced</span>
      )}
      {typeof day.stepCount === 'number' && (
        <span className="text-[10px] text-fg-tertiary">
          {day.stepCount >= 10_000 ? `${(day.stepCount / 1_000).toFixed(1)}k` : day.stepCount}
        </span>
      )}
    </button>
  );
}

function ShieldWidget({ shield }: { shield: ShieldStatus; onUseShield: () => void }) {
  return (
    <GlassCard className="flex items-center gap-4" data-testid="streak-shields">
      <ToneDisc icon={Shield} tone={shield.unlimited || shield.available > 0 ? 'indigo' : 'slate'} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="text-headline text-white">Streak Shields</p>
        <p className="text-subhead text-fg-secondary">
          {shield.unlimited
            ? 'Unlimited with Pro: your streak is always protected'
            : `${shield.available} of ${shield.max} available · tap a missed day to use one`}
        </p>
      </div>
      <span className="text-title2 font-bold tabular-nums text-brand-indigo">{shield.unlimited ? '∞' : shield.available}</span>
      <ChevronRight className="h-4 w-4 text-fg-tertiary" aria-hidden />
    </GlassCard>
  );
}

function MilestoneGrid({ milestones, currentStreak }: { milestones: Milestone[]; currentStreak: number }) {
  return (
    <GlassCard>
        <h2 className="mb-3 text-title3 text-white">Milestones</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {milestones.map(m => {
            const achieved = currentStreak >= m.days;
            return (
              <div key={m.days} className="rounded-xl bg-white/[0.04] p-3 text-center">
                <div className={`flex justify-center ${achieved ? '' : 'opacity-70'}`}>
                  <MilestoneBadge days={m.days} achieved={achieved} size={52} />
                </div>
                <p className={`mt-2 text-footnote font-semibold ${achieved ? 'text-white' : 'text-fg-secondary'}`}>{m.days} days</p>
                <p className="min-h-[30px] text-[11px] text-fg-tertiary line-clamp-2">{m.title}</p>
              </div>
            );
          })}
        </div>
    </GlassCard>
  );
}

function HistoryFeed({ entries }: { entries: EngagementHistoryEntry[] }) {
  return (
    <GlassCard>
        <h2 className="mb-2 text-title3 text-white">Recent activity</h2>
        <div>
          {entries.map((entry) => {
            const d = new Date(`${entry.date}T00:00:00`);
            const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <div key={entry.date} className="flex items-center justify-between border-b border-white/[0.06] py-2.5 last:border-0">
                <div className="flex items-center gap-3">
                  <ToneDisc icon={Flame} tone="green" size="sm" />
                  <span className="text-body text-white">{label}</span>
                </div>
                <span className="text-footnote text-fg-secondary">{entry.activity_count} activities</span>
              </div>
            );
          })}
        </div>
    </GlassCard>
  );
}

function MilestoneCelebration({
  milestone, currentStreak, onDismiss,
}: { milestone: Milestone; currentStreak: number; onDismiss: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onDismiss}
    >
      <motion.div
        className="bg-surface border border-hairline rounded-2xl shadow-ios-lg p-8 max-w-md w-full text-center space-y-4"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ type: 'spring', damping: 12 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <MilestoneBadge days={milestone.days} achieved size={120} />
        </div>
        <h2 className="text-3xl font-bold">{milestone.title}</h2>
        <p className="text-4xl font-extrabold text-brand-orange">{currentStreak} days</p>
        <p className="text-fg-secondary">{milestone.message}</p>
        <Button onClick={onDismiss} className="w-full">Continue</Button>
      </motion.div>
    </motion.div>
  );
}

function ShieldDialog({
  available, unlimited, date, onConfirm, onCancel,
}: { available: number; unlimited: boolean; date: string; onConfirm: () => void; onCancel: () => void }) {
  const canUse = unlimited || available > 0;
  // Out of shields: this dialog is a Pro upsell card.
  useTrackOnce(AnalyticsEvents.proCardShown({ source: 'streak_shield' }), !canUse);
  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="bg-surface border border-hairline rounded-2xl shadow-ios-lg p-6 max-w-sm w-full space-y-4"
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-indigo-400" />
          <h2 className="text-xl font-bold">Streak Shield</h2>
        </div>
        <p className="text-subhead text-fg-secondary">
          {unlimited
            ? `Pro includes unlimited shields. Use one to reclaim ${formatDay(date)}?`
            : available > 0
              ? `You have ${available} shield${available === 1 ? '' : 's'} available. Use one to reclaim ${formatDay(date)}?`
              : 'You’re out of shields. Earn one per week of streak (bonus each month) — or get FitCircle Pro for unlimited shields, so your streak is always protected.'}
        </p>
        <div className="flex gap-2">
          {canUse ? (
            <>
              <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
              <Button className="flex-1" onClick={onConfirm}>Use Shield</Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => {
                  analytics.track(AnalyticsEvents.proCardDismissed({ source: 'streak_shield' }));
                  onCancel();
                }}
              >
                Maybe later
              </Button>
              <Button asChild className="flex-1">
                <a
                  href="/upgrade?source=pro_card"
                  onClick={() => analytics.track(AnalyticsEvents.proCardTapped({ source: 'streak_shield' }))}
                >
                  Get Pro
                </a>
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function claimSubtitle({
  isTodayClaimed, canClaimToday, healthDataSynced, reason,
}: {
  isTodayClaimed: boolean;
  canClaimToday: boolean;
  healthDataSynced: boolean;
  reason?: string;
}): string {
  if (isTodayClaimed) return 'Already claimed';
  if (canClaimToday) return 'Tap to claim';
  if (!healthDataSynced) return 'Sync your data';
  if (reason) return reason;
  return 'Log today';
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

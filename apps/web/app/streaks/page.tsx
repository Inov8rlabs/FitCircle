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
  Flame, Sparkles, Trophy, Shield, Check, X, RefreshCcw, AlertTriangle,
  Trophy as TrophyIcon, Star, Crown, Medal,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import Celebration from '@/components/Celebration';
import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  type ClaimableDay,
  type ShieldStatus,
  type StreakEngagement,
  type EngagementHistoryEntry,
  streakClient,
} from '@/lib/api/streak-client';
import { useAuthStore } from '@/stores/auth-store';

// ─── Milestone metadata (matches iOS / Android) ─────────────────────────────

const MILESTONES = [
  { days: 7,   title: '7-Day Warrior',      badge: '🔥', message: 'One week strong!' },
  { days: 30,  title: 'Monthly Master',     badge: '💪', message: '30 days of excellence!' },
  { days: 60,  title: '60-Day Champion',    badge: '🏆', message: 'Two months of dedication!' },
  { days: 100, title: 'Centurion',          badge: '👑', message: '100 days of commitment!' },
  { days: 365, title: 'Year of Excellence', badge: '🌟', message: 'A full year!' },
] as const;

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
      if (result.milestone) {
        const m = MILESTONES.find(m => m.days === result.milestone!.days) ?? null;
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
      await streakClient.claimStreak(date, timezone);
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
      toast.success(result.message ?? 'Shield activated');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not activate shield');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your streak.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
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

        {/* Milestone grid */}
        <MilestoneGrid milestones={[...MILESTONES]} currentStreak={currentStreak} />

        {/* History */}
        {history.length > 0 && <HistoryFeed entries={history.slice(0, 21)} />}
      </main>

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
    <Card className="bg-card border-border">
      <CardContent className="p-6 space-y-6 text-center">
        <div className="space-y-1 text-left">
          <p className="text-sm font-semibold text-muted-foreground">Keep your streak alive</p>
          <p className="text-4xl font-bold">{currentStreak} day streak</p>
        </div>

        <div className="flex justify-center">
          <button
            type="button"
            disabled={!canClaimToday || isClaiming || isLoading}
            onClick={onClaim}
            className={`
              relative w-44 h-44 rounded-full flex flex-col items-center justify-center
              text-white font-bold shadow-2xl transition-transform
              ${isTodayClaimed
                ? 'bg-gradient-to-br from-emerald-500 to-cyan-500'
                : canClaimToday
                  ? 'bg-gradient-to-br from-orange-500 to-orange-400 hover:scale-105 animate-pulse'
                  : 'bg-gradient-to-br from-zinc-700 to-zinc-800 opacity-60 cursor-not-allowed'}
            `}
          >
            {isClaiming ? (
              <div className="h-10 w-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            ) : isTodayClaimed ? (
              <>
                <Check className="h-12 w-12" />
                <span className="text-2xl mt-1">{currentStreak}</span>
                <span className="text-xs">days claimed</span>
              </>
            ) : (
              <>
                <Flame className="h-12 w-12" />
                <span className="text-3xl">{currentStreak}</span>
                <span className="text-xs px-3 line-clamp-2">{subtitle}</span>
              </>
            )}
          </button>
        </div>

        {longestStreak > currentStreak && (
          <div className="inline-flex items-center gap-1 mx-auto rounded-full bg-cyan-500/15 px-3 py-1.5 text-cyan-400 text-xs font-semibold">
            <Sparkles className="h-3 w-3" />
            Best streak: {longestStreak} days
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HealthSyncCard() {
  return (
    <Card className="border-orange-500/30 bg-orange-500/5">
      <CardContent className="p-4 flex items-start gap-3">
        <div className="h-10 w-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-orange-400" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Health data missing</p>
          <p className="text-sm text-muted-foreground">
            Log today&apos;s steps or weight to unlock streak claiming.
          </p>
        </div>
      </CardContent>
    </Card>
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
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Last 7 Days</h2>
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
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
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
      </CardContent>
    </Card>
  );
}

function DayPill({ day, onTap }: { day: ClaimableDay; onTap: () => void }) {
  const date = new Date(`${day.date}T00:00:00`);
  const dayOfWeek = date.toLocaleDateString(undefined, { weekday: 'short' });
  const dayNumber = date.getDate();

  let bg = 'bg-gradient-to-br from-zinc-700 to-zinc-800';
  let icon: React.ReactNode = '—';
  let canTap = false;
  if (day.isFrozen) {
    bg = 'bg-gradient-to-br from-blue-500 to-blue-600';
    icon = <Shield className="h-4 w-4 text-white" />;
  } else if (day.claimed) {
    bg = 'bg-gradient-to-br from-emerald-500 to-emerald-600';
    icon = <Check className="h-5 w-5 text-white" />;
  } else if (day.canClaim) {
    bg = 'bg-gradient-to-br from-orange-500 to-orange-400 animate-pulse';
    icon = '🔥';
    canTap = true;
  } else {
    bg = 'bg-gradient-to-br from-red-500 to-red-600';
    icon = <X className="h-4 w-4 text-white" />;
    canTap = true; // tap opens shield dialog
  }

  return (
    <button
      type="button"
      disabled={day.claimed || day.isFrozen}
      onClick={onTap}
      className={`
        flex flex-col items-center gap-1 min-w-[64px] rounded-xl bg-card px-3 py-3
        ${canTap ? 'hover:scale-105' : ''} transition-transform
      `}
    >
      <div className={`h-12 w-12 rounded-full flex items-center justify-center text-xl shadow-lg ${bg}`}>
        {icon}
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{dayOfWeek}</span>
      <span className="text-xs font-bold">{dayNumber}</span>
      {day.hasHealthData && (
        <span className="text-[10px] text-emerald-500 font-medium">✓ Synced</span>
      )}
      {typeof day.stepCount === 'number' && (
        <span className="text-[10px] text-muted-foreground">
          {day.stepCount >= 10_000 ? `${(day.stepCount / 1_000).toFixed(1)}k` : day.stepCount}
        </span>
      )}
    </button>
  );
}

function ShieldWidget({ shield }: { shield: ShieldStatus; onUseShield: () => void }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <div className="h-12 w-12 rounded-full bg-indigo-500/15 flex items-center justify-center">
          <Shield className="h-6 w-6 text-indigo-400" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Streak shields</p>
          <p className="text-sm text-muted-foreground">
            {shield.available} / {shield.max} available — protect missed days
          </p>
        </div>
        <div className="text-2xl font-bold text-indigo-400">{shield.available}</div>
      </CardContent>
    </Card>
  );
}

function MilestoneGrid({ milestones, currentStreak }: { milestones: Milestone[]; currentStreak: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-lg font-semibold mb-3">Milestones</h2>
        <div className="grid grid-cols-3 gap-2">
          {milestones.map(m => {
            const achieved = currentStreak >= m.days;
            return (
              <div
                key={m.days}
                className={`rounded-xl p-3 text-center bg-card-foreground/5 ${achieved ? '' : 'opacity-40'}`}
              >
                <div className={`mx-auto h-12 w-12 rounded-full flex items-center justify-center text-2xl ${achieved ? 'bg-gradient-to-br from-orange-500 to-orange-400 shadow-lg' : 'bg-zinc-800'}`}>
                  {m.badge}
                </div>
                <p className="mt-2 text-xs font-semibold">{m.days} days</p>
                <p className="text-[10px] text-muted-foreground line-clamp-2">{m.title}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryFeed({ entries }: { entries: EngagementHistoryEntry[] }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="text-lg font-semibold mb-3">Recent activity</h2>
        <div className="space-y-2">
          {entries.map((entry) => {
            const d = new Date(`${entry.date}T00:00:00`);
            const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            return (
              <div key={entry.date} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
                    <Flame className="h-4 w-4 text-emerald-500" />
                  </div>
                  <span className="text-sm">{label}</span>
                </div>
                <span className="text-xs text-muted-foreground">{entry.activity_count} activities</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MilestoneCelebration({
  milestone, currentStreak, onDismiss,
}: { milestone: Milestone; currentStreak: number; onDismiss: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onDismiss}
    >
      <motion.div
        className="bg-card border border-border rounded-2xl p-8 max-w-md w-full text-center space-y-4"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ type: 'spring', damping: 12 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-7xl">{milestone.badge}</div>
        <h2 className="text-3xl font-bold">{milestone.title}</h2>
        <p className="text-4xl font-extrabold text-orange-500">{currentStreak} days</p>
        <p className="text-muted-foreground">{milestone.message}</p>
        <Button onClick={onDismiss} className="w-full">Continue</Button>
      </motion.div>
    </motion.div>
  );
}

function ShieldDialog({
  available, date, onConfirm, onCancel,
}: { available: number; date: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4"
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <Shield className="h-8 w-8 text-indigo-400" />
          <h2 className="text-xl font-bold">Streak Shield</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {available > 0
            ? `You have ${available} shield${available === 1 ? '' : 's'} available. Use one to reclaim ${formatDay(date)}?`
            : `No shields available. Earn one by hitting your next milestone!`}
        </p>
        <div className="flex gap-2">
          {available > 0 ? (
            <>
              <Button variant="ghost" className="flex-1" onClick={onCancel}>Cancel</Button>
              <Button className="flex-1 bg-indigo-500 hover:bg-indigo-600" onClick={onConfirm}>Use Shield</Button>
            </>
          ) : (
            <Button className="w-full" onClick={onCancel}>Got it</Button>
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

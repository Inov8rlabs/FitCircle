'use client';

/**
 * Momentum page — web port of iOS `MomentumDetailView` + `MomentumFlameView` +
 * `MomentumMilestoneView`. Shows current momentum, animated flame, grace day
 * status, next milestone, and full milestone history.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Shield, ShieldOff, Sparkles, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import Celebration from '@/components/Celebration';
import { MomentumFlame } from '@/components/MomentumFlame';
import { ShareCardButton } from '@/components/ShareCardButton';
import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  type MomentumMilestone,
  type MomentumStatus,
  momentumClient,
} from '@/lib/api/momentum-client';
import { useAuthStore } from '@/stores/auth-store';

export default function MomentumPage() {
  const { isAuthenticated } = useAuthStore();
  const [status, setStatus] = useState<MomentumStatus | null>(null);
  const [milestones, setMilestones] = useState<MomentumMilestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [celebrate, setCelebrate] = useState<MomentumMilestone | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.allSettled([
        momentumClient.getStatus(),
        momentumClient.getMilestones(),
      ]);
      if (s.status === 'fulfilled') setStatus(s.value);
      if (m.status === 'fulfilled') setMilestones(m.value.milestones);
    } catch (e) {
      console.warn('[momentum] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCheckIn = async () => {
    if (isCheckingIn || status?.checked_in_today) return;
    setIsCheckingIn(true);
    try {
      const result = await momentumClient.checkIn();
      if (result.milestone_achieved) {
        setCelebrate(result.milestone_achieved);
      } else if (result.is_first_check_in_today) {
        toast.success('Momentum check-in! 🔥');
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not check in');
    } finally {
      setIsCheckingIn(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your momentum.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {isLoading || !status ? (
          <Card><CardContent className="p-8 h-80" /></Card>
        ) : (
          <>
            <FlameCard
              status={status}
              isCheckingIn={isCheckingIn}
              onCheckIn={handleCheckIn}
            />
            <GraceDayCard
              available={status.grace_day_available}
              usedThisWeek={status.grace_day_used_this_week}
            />
            {status.next_milestone && (
              <NextMilestoneCard
                milestone={status.next_milestone}
                daysAway={status.days_to_next_milestone ?? 0}
              />
            )}
            <MilestonesGrid milestones={milestones} currentMomentum={status.current_momentum} />
          </>
        )}
      </main>

      <AnimatePresence>
        {celebrate && (
          <MilestoneCelebration
            milestone={celebrate}
            currentMomentum={status?.current_momentum ?? 0}
            onDismiss={() => setCelebrate(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FlameCard({
  status, isCheckingIn, onCheckIn,
}: { status: MomentumStatus; isCheckingIn: boolean; onCheckIn: () => void }) {
  return (
    <Card>
      <CardContent className="p-8 flex flex-col items-center gap-4">
        <MomentumFlame level={status.flame_level} size={140} />

        <div className="text-center">
          <p className="text-5xl font-black bg-gradient-to-br from-orange-500 to-orange-300 bg-clip-text text-transparent">
            {status.current_momentum}
          </p>
          <p className="text-sm font-semibold text-muted-foreground mt-1">Day Momentum</p>
        </div>

        {status.best_momentum > status.current_momentum && (
          <div className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-3 py-1 text-yellow-500 text-xs font-semibold">
            <Trophy className="h-3 w-3" />
            Best: {status.best_momentum} days
          </div>
        )}

        {/* Flame level dots (1–5) */}
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-2.5 w-2.5 rounded-full transition-colors ${
                i <= status.flame_level ? FLAME_DOT_COLORS[status.flame_level] : 'bg-zinc-700'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Level {status.flame_level} — {status.flame_label}</p>

        <Button
          onClick={onCheckIn}
          disabled={isCheckingIn || status.checked_in_today}
          className={`w-full ${status.checked_in_today ? 'bg-emerald-500 hover:bg-emerald-500' : 'bg-gradient-to-r from-orange-500 to-orange-400 hover:opacity-90'}`}
        >
          {status.checked_in_today
            ? '✓ Checked in today'
            : isCheckingIn
              ? 'Checking in...'
              : 'Check in to keep momentum'}
        </Button>
      </CardContent>
    </Card>
  );
}

function GraceDayCard({ available, usedThisWeek }: { available: boolean; usedThisWeek: boolean }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        {available ? (
          <Shield className="h-6 w-6 text-emerald-500" />
        ) : (
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        )}
        <div className="flex-1">
          <p className="font-semibold">Grace day</p>
          <p className="text-sm text-muted-foreground">
            {usedThisWeek ? 'Used this week' : available ? 'Available — one missed day a week is protected' : 'Used'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function NextMilestoneCard({ milestone, daysAway }: { milestone: MomentumMilestone; daysAway: number }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="text-3xl">{milestone.badge}</div>
        <div className="flex-1">
          <p className="font-semibold">{milestone.name}</p>
          <p className="text-sm text-muted-foreground">{milestone.description}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-orange-500">{daysAway}</p>
          <p className="text-xs text-muted-foreground">{daysAway === 1 ? 'day to go' : 'days to go'}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MilestonesGrid({
  milestones, currentMomentum,
}: { milestones: MomentumMilestone[]; currentMomentum: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h2 className="font-semibold mb-3">Milestones</h2>
        <div className="grid grid-cols-3 gap-2">
          {milestones.map(m => (
            <div
              key={m.days}
              className={`rounded-xl p-3 text-center ${m.unlocked ? 'bg-zinc-800' : 'bg-zinc-900 opacity-40'}`}
            >
              <div className="text-3xl">{m.unlocked ? m.badge : <Lock className="mx-auto h-7 w-7 text-muted-foreground" />}</div>
              <p className="mt-2 text-xs font-semibold">{m.days} days</p>
              <p className="text-[10px] text-muted-foreground line-clamp-2">{m.name}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MilestoneCelebration({
  milestone, currentMomentum, onDismiss,
}: { milestone: MomentumMilestone; currentMomentum: number; onDismiss: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] bg-background/95 backdrop-blur-sm flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onDismiss}
    >
      <Celebration onComplete={() => {/* keep showing */}} />
      <motion.div
        className="relative bg-card border border-border rounded-2xl p-8 max-w-md w-full text-center space-y-4"
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.7, opacity: 0 }}
        transition={{ type: 'spring', damping: 12 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="text-7xl">{milestone.badge}</div>
        <h2 className="text-3xl font-bold">{milestone.name}</h2>
        <p className="text-4xl font-extrabold text-orange-500">{currentMomentum} days</p>
        <p className="text-muted-foreground">{milestone.description}</p>
        <ShareCardButton
          context={{
            type: 'milestone',
            data: {
              milestoneName: milestone.name,
              dayCount: milestone.days,
              badgeEmoji: milestone.badge,
              currentStreak: currentMomentum,
            },
          }}
          style="primary"
          label="Share milestone"
        />
        <Button variant="ghost" onClick={onDismiss} className="w-full">Continue</Button>
      </motion.div>
    </motion.div>
  );
}

const FLAME_DOT_COLORS: Record<number, string> = {
  1: 'bg-yellow-400',
  2: 'bg-orange-400',
  3: 'bg-orange-500',
  4: 'bg-pink-500',
  5: 'bg-blue-400',
};

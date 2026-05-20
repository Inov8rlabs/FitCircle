'use client';

/**
 * Daily Challenge page — web port of iOS `DailyChallengeDetailView` +
 * `DailyChallengeProgressView` + leaderboard. Composes:
 *
 *  - Challenge info card (name, date, description, goal, participants)
 *  - Progress card (join CTA → progress bar → manual input + submit →
 *    quick-add buttons + "Almost there!" hint)
 *  - Leaderboard
 *  - Celebration on completion
 */

import { motion, AnimatePresence } from 'framer-motion';
import {
  Flag, Users, Trophy, Sparkles, GroupIcon, Plus, Check, Loader2, ChevronUp,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import Celebration from '@/components/Celebration';
import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  type DailyChallengeWithProgress,
  type LeaderboardEntry,
  dailyChallengeClient,
} from '@/lib/api/daily-challenge-client';
import { useAuthStore } from '@/stores/auth-store';

export default function DailyChallengePage() {
  const { isAuthenticated } = useAuthStore();
  const [challenge, setChallenge] = useState<DailyChallengeWithProgress | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [progressInput, setProgressInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await dailyChallengeClient.getCurrent();
      setChallenge(c);
      if (c.user_joined) {
        const lb = await dailyChallengeClient.getLeaderboard(c.id).catch(() => ({ entries: [] }));
        setLeaderboard(lb.entries);
      }
    } catch (e) {
      console.warn('[daily-challenge] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleJoin = async () => {
    if (!challenge || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await dailyChallengeClient.join(challenge.id);
      toast.success('Joined challenge!');
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not join');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!challenge || isSubmitting) return;
    const value = Number(progressInput);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a positive amount');
      return;
    }
    setIsSubmitting(true);
    const wasCompleted = challenge.user_completed;
    try {
      const next = await dailyChallengeClient.updateProgress(challenge.id, value);
      setChallenge(next);
      setProgressInput('');
      if (next.user_completed && !wasCompleted) setCelebrate(true);
      const lb = await dailyChallengeClient.getLeaderboard(challenge.id).catch(() => ({ entries: [] }));
      setLeaderboard(lb.entries);
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not update progress');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to view today's challenge.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {isLoading ? (
          <Card>
            <CardContent className="p-8 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : !challenge ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No challenge today.
            </CardContent>
          </Card>
        ) : (
          <>
            <ChallengeInfoCard challenge={challenge} />
            <ProgressCard
              challenge={challenge}
              progressInput={progressInput}
              isSubmitting={isSubmitting}
              onJoin={handleJoin}
              onChangeInput={setProgressInput}
              onSubmit={handleSubmit}
              onQuickAdd={(v) => setProgressInput(formatAmount(v))}
            />
            {leaderboard.length > 0 && <Leaderboard entries={leaderboard} goal={challenge.goal_amount} />}
          </>
        )}
      </main>

      <AnimatePresence>
        {celebrate && (
          <motion.div className="pointer-events-none fixed inset-0 z-50">
            <Celebration onComplete={() => setCelebrate(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function ChallengeInfoCard({ challenge }: { challenge: DailyChallengeWithProgress }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-orange-500/20 flex items-center justify-center">
            <Flag className="h-6 w-6 text-orange-500" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold">{challenge.name}</h1>
            <p className="text-sm text-muted-foreground">{challenge.challenge_date}</p>
          </div>
        </div>
        {challenge.description && (
          <p className="text-sm text-muted-foreground">{challenge.description}</p>
        )}
        <div className="flex justify-between border-t border-border pt-3">
          <div>
            <p className="text-xs text-muted-foreground">Goal</p>
            <p className="text-lg font-bold text-orange-500">
              {formatAmount(challenge.goal_amount)} {challenge.unit}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Participants</p>
            <p className="text-lg font-bold text-indigo-400">{challenge.participant_count}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressCard({
  challenge, progressInput, isSubmitting, onJoin, onChangeInput, onSubmit, onQuickAdd,
}: {
  challenge: DailyChallengeWithProgress;
  progressInput: string;
  isSubmitting: boolean;
  onJoin: () => void;
  onChangeInput: (v: string) => void;
  onSubmit: () => void;
  onQuickAdd: (v: number) => void;
}) {
  if (!challenge.user_joined) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-4">
          <GroupIcon className="h-12 w-12 mx-auto text-indigo-400" />
          <h2 className="text-lg font-semibold">Join today's challenge!</h2>
          <Button
            onClick={onJoin}
            disabled={isSubmitting}
            className="w-full bg-indigo-500 hover:bg-indigo-600"
          >
            {isSubmitting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <><Plus className="h-4 w-4 mr-2" />Join Challenge</>}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const progress = challenge.user_progress ?? 0;
  const fraction = Math.min(1, progress / challenge.goal_amount);
  const remaining = Math.max(0, challenge.goal_amount - progress);
  const percentage = Math.round(fraction * 100);
  const isCompleted = challenge.user_completed;

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <h2 className="font-semibold">Your Progress</h2>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">
              {formatAmount(progress)} / {formatAmount(challenge.goal_amount)} {challenge.unit}
            </span>
            <span className={`font-bold ${isCompleted ? 'text-emerald-500' : 'text-orange-500'}`}>
              {percentage}%
            </span>
          </div>
          <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
            <motion.div
              className={`h-full ${isCompleted ? 'bg-emerald-500' : 'bg-orange-500'}`}
              initial={{ width: 0 }}
              animate={{ width: `${fraction * 100}%` }}
              transition={{ type: 'spring', stiffness: 100, damping: 20 }}
            />
          </div>
        </div>

        {isCompleted ? (
          <div className="flex items-center justify-center gap-2 text-emerald-500 py-2">
            <Check className="h-5 w-5" /> <span className="font-semibold">Goal achieved!</span>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                type="number"
                inputMode="decimal"
                placeholder={`Add ${challenge.unit}`}
                value={progressInput}
                onChange={(e) => onChangeInput(e.target.value)}
                className="flex-1"
              />
              <Button
                onClick={onSubmit}
                disabled={isSubmitting || !progressInput}
                className="bg-orange-500 hover:bg-orange-600"
              >
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log'}
              </Button>
            </div>

            <QuickAddButtons
              unit={challenge.unit}
              goalAmount={challenge.goal_amount}
              remaining={remaining}
              onPick={onQuickAdd}
            />

            {fraction >= 0.8 && (
              <div className="flex items-center justify-center gap-2 rounded-md bg-yellow-500/10 py-2 text-yellow-500 text-sm font-semibold">
                <Sparkles className="h-4 w-4" /> Almost there! Keep pushing!
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function QuickAddButtons({
  unit, goalAmount, remaining, onPick,
}: {
  unit: string;
  goalAmount: number;
  remaining: number;
  onPick: (v: number) => void;
}) {
  const amounts = quickAddAmounts(unit, goalAmount);
  return (
    <div className="flex gap-2">
      {amounts.map((amount) => (
        <button
          key={amount}
          type="button"
          onClick={() => onPick(amount)}
          className="flex-1 rounded-md bg-orange-500/10 px-2 py-1.5 text-xs font-semibold text-orange-500 hover:bg-orange-500/20 transition-colors"
        >
          +{formatAmount(amount)}
        </button>
      ))}
      {remaining > 0 && (
        <button
          type="button"
          onClick={() => onPick(remaining)}
          className="flex-1 rounded-md bg-gradient-to-r from-orange-500 to-orange-400 px-2 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
        >
          All
        </button>
      )}
    </div>
  );
}

function Leaderboard({ entries, goal }: { entries: LeaderboardEntry[]; goal: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="font-semibold mb-3">Leaderboard</h2>
        <div className="space-y-2">
          {entries.slice(0, 20).map((entry, idx) => {
            const pct = Math.min(100, Math.round((entry.progress / goal) * 100));
            return (
              <div key={entry.user_id} className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold ${idx === 0 ? 'bg-yellow-500/20 text-yellow-500' : idx === 1 ? 'bg-zinc-400/20 text-zinc-300' : idx === 2 ? 'bg-orange-700/20 text-orange-400' : 'bg-zinc-800 text-zinc-400'}`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{entry.display_name}</p>
                  <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden mt-1">
                    <div
                      className={`h-full ${entry.is_completed ? 'bg-emerald-500' : 'bg-orange-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{pct}%</span>
                {entry.is_completed && <Check className="h-4 w-4 text-emerald-500" />}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(amount: number): string {
  return amount % 1 === 0 ? String(amount) : amount.toFixed(1);
}

function quickAddAmounts(unit: string, goalAmount: number): number[] {
  if (unit === 'steps') return [1000, 2500, 5000];
  if (unit === 'reps') return [10, 25, Math.max(1, Math.floor(goalAmount / 2))];
  if (unit === 'km' || unit === 'miles') return [1, 2.5, 5];
  return [goalAmount * 0.25, goalAmount * 0.5, goalAmount * 0.75].map(v => Math.max(1, v));
}

'use client';

/**
 * Quests + Boost section for the FitCircle detail page.
 * Drop into `app/fitcircles/[id]/page.tsx` next to `CircleChallengesSection`.
 *
 * Mirrors iOS `CircleQuestsView` + `CircleBoostView`.
 */

import { motion } from 'framer-motion';
import { Zap, Target, Users, Flame, TrendingUp, Clock, Trophy, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import {
  type BoostHistoryEntry,
  type BoostStatus,
  type QuestWithProgress,
  boostClient,
  questClient,
} from '@/lib/api/quest-boost-client';

interface Props {
  circleId: string;
}

export default function CircleQuestsSection({ circleId }: Props) {
  const [quests, setQuests] = useState<QuestWithProgress[]>([]);
  const [boost, setBoost] = useState<BoostStatus | null>(null);
  const [boostHistory, setBoostHistory] = useState<BoostHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [questsRes, boostRes, historyRes] = await Promise.allSettled([
        questClient.listForCircle(circleId),
        boostClient.getStatus(circleId),
        boostClient.getHistory(circleId, 7),
      ]);
      if (questsRes.status === 'fulfilled') setQuests(questsRes.value.quests);
      if (boostRes.status === 'fulfilled') setBoost(boostRes.value);
      if (historyRes.status === 'fulfilled') setBoostHistory(historyRes.value.history);
    } catch (e) {
      console.warn('[quests-boost] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, [circleId]);

  useEffect(() => { void load(); }, [load]);

  if (isLoading) {
    return (
      <Card><CardContent className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      {boost && <BoostCard boost={boost} history={boostHistory} />}
      {quests.length > 0 && <QuestsList quests={quests} />}
    </div>
  );
}

function BoostCard({ boost, history }: { boost: BoostStatus; history: BoostHistoryEntry[] }) {
  const checkInPct = boost.total_members > 0 ? Math.round((boost.checked_in_members / boost.total_members) * 100) : 0;
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-400" />
            <h2 className="font-semibold">Circle Boost</h2>
          </div>
          {boost.is_perfect_day && (
            <div className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-3 py-1 text-yellow-400 text-xs font-bold">
              <Flame className="h-3 w-3" /> Perfect day
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-zinc-800/50 p-3">
            <p className="text-2xl font-bold text-yellow-400">{boost.boost_multiplier.toFixed(1)}x</p>
            <p className="text-[10px] text-muted-foreground uppercase mt-1">Multiplier</p>
          </div>
          <div className="rounded-xl bg-zinc-800/50 p-3">
            <p className="text-2xl font-bold">{boost.checked_in_members}/{boost.total_members}</p>
            <p className="text-[10px] text-muted-foreground uppercase mt-1">Checked in</p>
          </div>
          <div className="rounded-xl bg-zinc-800/50 p-3">
            <p className="text-2xl font-bold text-emerald-400">{checkInPct}%</p>
            <p className="text-[10px] text-muted-foreground uppercase mt-1">Participation</p>
          </div>
        </div>

        {/* Member status row */}
        {boost.member_statuses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {boost.member_statuses.slice(0, 12).map(m => (
              <div
                key={m.user_id}
                className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs ${m.checked_in ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-muted-foreground'}`}
              >
                <div className={`h-1.5 w-1.5 rounded-full ${m.checked_in ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                {m.display_name.split(' ')[0]}
              </div>
            ))}
          </div>
        )}

        {/* 7-day history */}
        {history.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Last 7 days
            </p>
            <div className="flex gap-1">
              {history.slice().reverse().map(h => (
                <div
                  key={h.boost_date}
                  className="flex-1 text-center"
                  title={`${h.boost_date}: ${h.checked_in_members}/${h.total_members}`}
                >
                  <div
                    className={`h-8 rounded ${h.is_perfect_day ? 'bg-yellow-400' : h.checked_in_members === 0 ? 'bg-zinc-800' : 'bg-emerald-500/70'}`}
                    style={{ opacity: h.total_members > 0 ? 0.4 + (h.checked_in_members / h.total_members) * 0.6 : 0.1 }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuestsList({ quests }: { quests: QuestWithProgress[] }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-purple-400" />
          <h2 className="font-semibold">Active Quests</h2>
        </div>
        <div className="space-y-2">
          {quests.map(q => <QuestRow key={q.id} quest={q} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function QuestRow({ quest }: { quest: QuestWithProgress }) {
  const isCollective = quest.quest_type === 'collaborative';
  const target = isCollective ? (quest.collective_target ?? quest.goal_amount) : quest.goal_amount;
  const progress = isCollective ? quest.collective_progress : quest.my_progress;
  const fraction = Math.min(1, progress / target);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl bg-zinc-800/40 p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{quest.quest_name}</p>
          <p className="text-xs text-muted-foreground">
            {quest.quest_type} · {Math.max(0, quest.days_remaining)}d left
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" /> {quest.participant_count}
        </div>
      </div>
      <div className="space-y-1">
        <div className="h-1.5 rounded-full bg-zinc-900 overflow-hidden">
          <div
            className="h-full bg-purple-500"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{formatNumber(progress)} / {formatNumber(target)} {quest.unit}</span>
          <span className="font-semibold text-purple-300">{Math.round(fraction * 100)}%</span>
        </div>
      </div>
    </motion.div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

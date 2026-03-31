'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Trophy,
  Medal,
  Flame,
  ChevronUp,
  Hand,
  RefreshCw,
  Crown,
} from 'lucide-react';
import { toast } from 'sonner';
import { ChallengeLeaderboardEntry, CircleChallengeWithDetails } from '@/lib/types/circle-challenge';

interface ChallengeLeaderboardProps {
  challenge: CircleChallengeWithDetails;
  circleId: string;
  onHighFive?: (userId: string) => void;
}

const MEDAL_ICONS = ['', '🥇', '🥈', '🥉'];

export default function ChallengeLeaderboard({
  challenge,
  circleId,
  onHighFive,
}: ChallengeLeaderboardProps) {
  const [entries, setEntries] = useState<ChallengeLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/fitcircles/${circleId}/challenges/${challenge.id}/leaderboard`
      );
      const result = await response.json();
      if (result.success) {
        setEntries(result.data);
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setLoading(false);
    }
  }, [circleId, challenge.id]);

  useEffect(() => {
    fetchLeaderboard();

    // Poll every 60s for active challenges
    if (challenge.status === 'active') {
      const interval = setInterval(fetchLeaderboard, 60_000);
      return () => clearInterval(interval);
    }
  }, [fetchLeaderboard, challenge.status]);

  const handleHighFive = async (toUserId: string) => {
    try {
      const response = await fetch(
        `/api/fitcircles/${circleId}/challenges/${challenge.id}/high-fives`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_user_id: toUserId }),
        }
      );
      const result = await response.json();
      if (result.success) {
        toast.success('High five sent!');
        onHighFive?.(toUserId);
      }
    } catch (err) {
      toast.error('Failed to send high five');
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <Trophy className="w-10 h-10 text-slate-600 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No participants yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Winner Podium for completed challenges */}
      {challenge.status === 'completed' && entries.length >= 1 && (
        <Card className="border-yellow-500/30 bg-gradient-to-br from-yellow-500/10 to-orange-500/10 mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="w-5 h-5 text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-300">Final Results</span>
            </div>
            <div className="flex items-end justify-center gap-4">
              {entries.slice(0, 3).map((entry, i) => (
                <div
                  key={entry.user_id}
                  className={`text-center ${i === 0 ? 'order-2' : i === 1 ? 'order-1' : 'order-3'}`}
                >
                  <div
                    className={`w-12 h-12 rounded-full mx-auto mb-1 flex items-center justify-center text-lg font-bold ${
                      i === 0
                        ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-white ring-2 ring-yellow-400/50'
                        : i === 1
                        ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-white'
                        : 'bg-gradient-to-br from-orange-600 to-orange-700 text-white'
                    }`}
                  >
                    {entry.avatar_url ? (
                      <img src={entry.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      entry.display_name[0]?.toUpperCase()
                    )}
                  </div>
                  <p className="text-xs text-white font-medium truncate max-w-[80px]">
                    {entry.display_name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {entry.cumulative_total.toLocaleString()} {challenge.unit}
                  </p>
                  <span className="text-lg">{MEDAL_ICONS[i + 1]}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leaderboard Entries */}
      {entries.map((entry, index) => (
        <motion.div
          key={entry.user_id}
          layout
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.03 }}
        >
          <div
            className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
              entry.is_current_user
                ? 'bg-indigo-500/10 border border-indigo-500/30'
                : 'bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800'
            }`}
          >
            {/* Rank */}
            <div className="w-8 text-center flex-shrink-0">
              {entry.rank <= 3 ? (
                <span className="text-lg">{MEDAL_ICONS[entry.rank]}</span>
              ) : (
                <span className="text-sm font-bold text-slate-500">#{entry.rank}</span>
              )}
            </div>

            {/* Avatar */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
              {entry.avatar_url ? (
                <img src={entry.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                entry.display_name[0]?.toUpperCase() || '?'
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white truncate">
                  {entry.display_name}
                  {entry.is_current_user && (
                    <span className="text-xs text-indigo-400 ml-1">(you)</span>
                  )}
                </span>
                {entry.current_streak > 0 && (
                  <span className="flex items-center gap-0.5 text-xs text-orange-400">
                    <Flame className="w-3 h-3" />
                    {entry.current_streak}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-sm font-bold text-white">
                  {entry.cumulative_total.toLocaleString()} {challenge.unit}
                </span>
                {entry.today_total > 0 && (
                  <span className="text-xs text-slate-500">
                    +{entry.today_total.toLocaleString()} today
                  </span>
                )}
              </div>
              {/* Progress bar */}
              <Progress
                value={entry.goal_completion_pct}
                className="h-1 mt-1.5 bg-slate-700"
              />
            </div>

            {/* Gap to next / High five */}
            <div className="flex-shrink-0 text-right">
              {entry.is_current_user && entry.gap_to_next && entry.gap_to_next > 0 && (
                <div className="text-xs text-slate-500">
                  <ChevronUp className="w-3 h-3 inline" />
                  {entry.gap_to_next.toLocaleString()} to pass
                </div>
              )}
              {!entry.is_current_user && challenge.status === 'active' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleHighFive(entry.user_id);
                  }}
                  className="p-1.5 rounded-full hover:bg-slate-700 transition-all group"
                  title="High five!"
                >
                  <Hand className="w-4 h-4 text-slate-500 group-hover:text-yellow-400 transition-colors" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      ))}

      {/* Last updated */}
      {lastUpdated && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={fetchLeaderboard}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-all"
          >
            <RefreshCw className="w-3 h-3" />
            Updated {lastUpdated.toLocaleTimeString()}
          </button>
        </div>
      )}
    </div>
  );
}

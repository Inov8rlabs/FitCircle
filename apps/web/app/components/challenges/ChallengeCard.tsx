'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Users, Calendar, Trophy, Flame, Clock } from 'lucide-react';
import { CircleChallengeWithDetails } from '@/lib/types/circle-challenge';

interface ChallengeCardProps {
  challenge: CircleChallengeWithDetails;
  onClick: () => void;
  index?: number;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-500/20 text-green-400 border-green-500/30' },
  scheduled: { label: 'Upcoming', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  completed: { label: 'Completed', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

const CATEGORY_GRADIENTS: Record<string, string> = {
  strength: 'from-red-500/10 to-orange-500/10 hover:from-red-500/20 hover:to-orange-500/20',
  cardio: 'from-blue-500/10 to-cyan-500/10 hover:from-blue-500/20 hover:to-cyan-500/20',
  flexibility: 'from-purple-500/10 to-pink-500/10 hover:from-purple-500/20 hover:to-pink-500/20',
  wellness: 'from-green-500/10 to-emerald-500/10 hover:from-green-500/20 hover:to-emerald-500/20',
  custom: 'from-indigo-500/10 to-violet-500/10 hover:from-indigo-500/20 hover:to-violet-500/20',
};

export default function ChallengeCard({ challenge, onClick, index = 0 }: ChallengeCardProps) {
  const status = STATUS_CONFIG[challenge.status] || STATUS_CONFIG.active;
  const gradient = CATEGORY_GRADIENTS[challenge.category] || CATEGORY_GRADIENTS.custom;
  const myProgress = challenge.my_participation?.goal_completion_pct || 0;
  const myRank = challenge.my_participation?.rank;
  const templateIcon = challenge.template?.icon || '⭐';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        className={`cursor-pointer border-slate-700/50 bg-gradient-to-br ${gradient} transition-all hover:shadow-lg hover:border-slate-600`}
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">{templateIcon}</span>
              <div>
                <h3 className="font-semibold text-white text-sm">{challenge.name}</h3>
                <p className="text-xs text-slate-500">by {challenge.creator_name}</p>
              </div>
            </div>
            <Badge variant="outline" className={status.className}>
              {status.label}
            </Badge>
          </div>

          {/* Progress bar for active challenges */}
          {challenge.status === 'active' && challenge.my_participation && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-400">
                  {challenge.my_participation.cumulative_total.toLocaleString()} / {challenge.goal_amount.toLocaleString()} {challenge.unit}
                </span>
                <span className="text-indigo-400">{Math.round(myProgress)}%</span>
              </div>
              <Progress value={myProgress} className="h-1.5 bg-slate-800" />
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span>{challenge.participant_count}</span>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>
                {challenge.status === 'active'
                  ? `${challenge.days_remaining}d left`
                  : challenge.status === 'scheduled'
                  ? `Starts ${new Date(challenge.starts_at).toLocaleDateString()}`
                  : 'Ended'}
              </span>
            </div>
            {myRank && challenge.status === 'active' && (
              <div className="flex items-center gap-1">
                <Trophy className="w-3 h-3 text-yellow-400" />
                <span className="text-yellow-400">#{myRank}</span>
              </div>
            )}
            {challenge.my_participation && challenge.my_participation.current_streak > 0 && (
              <div className="flex items-center gap-1">
                <Flame className="w-3 h-3 text-orange-400" />
                <span className="text-orange-400">{challenge.my_participation.current_streak}d</span>
              </div>
            )}
          </div>

          {/* Winner banner for completed challenges */}
          {challenge.status === 'completed' && challenge.winner_user_id && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <span className="text-xs text-yellow-300 font-medium">Challenge completed!</span>
            </div>
          )}

          {/* Join CTA for non-participants */}
          {!challenge.my_participation && challenge.status !== 'completed' && challenge.is_open && (
            <div className="mt-3 flex items-center justify-center px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-all">
              <span className="text-xs text-indigo-400 font-medium">Tap to join</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

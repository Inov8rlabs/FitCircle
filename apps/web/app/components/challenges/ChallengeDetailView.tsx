'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  ArrowLeft,
  Calendar,
  Users,
  Trophy,
  Flame,
  Plus,
  Target,
  Clock,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';
import {
  CircleChallengeWithDetails,
  CircleChallengeLog,
  LogActivityResponse,
} from '@/lib/types/circle-challenge';
import ChallengeLeaderboard from './ChallengeLeaderboard';
import LogActivitySheet from './LogActivitySheet';

interface ChallengeDetailViewProps {
  challengeId: string;
  circleId: string;
  onBack: () => void;
}

type Tab = 'leaderboard' | 'activity' | 'details';

export default function ChallengeDetailView({
  challengeId,
  circleId,
  onBack,
}: ChallengeDetailViewProps) {
  const { user } = useAuthStore();
  const [challenge, setChallenge] = useState<CircleChallengeWithDetails | null>(null);
  const [myLogs, setMyLogs] = useState<CircleChallengeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('leaderboard');
  const [showLogSheet, setShowLogSheet] = useState(false);
  const [joining, setJoining] = useState(false);

  const fetchChallenge = useCallback(async () => {
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/challenges/${challengeId}`);
      const result = await response.json();
      if (result.success) {
        setChallenge(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch challenge:', err);
    } finally {
      setLoading(false);
    }
  }, [circleId, challengeId]);

  const fetchMyLogs = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/fitcircles/${circleId}/challenges/${challengeId}/logs`
      );
      const result = await response.json();
      if (result.success) {
        setMyLogs(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, [circleId, challengeId]);

  useEffect(() => {
    fetchChallenge();
    fetchMyLogs();
  }, [fetchChallenge, fetchMyLogs]);

  const handleLogSuccess = (result: LogActivityResponse) => {
    fetchChallenge();
    fetchMyLogs();
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      const response = await fetch(
        `/api/fitcircles/${circleId}/challenges/${challengeId}/join`,
        { method: 'POST' }
      );
      const result = await response.json();
      if (result.success) {
        toast.success('Joined the challenge!');
        fetchChallenge();
      } else {
        throw new Error(result.error?.message);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setJoining(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!confirm('Delete this log entry?')) return;
    try {
      const response = await fetch(
        `/api/fitcircles/${circleId}/challenges/${challengeId}/logs/${logId}`,
        { method: 'DELETE' }
      );
      const result = await response.json();
      if (result.success) {
        toast.success('Log deleted');
        fetchChallenge();
        fetchMyLogs();
      }
    } catch (err) {
      toast.error('Failed to delete log');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-32 rounded-xl bg-slate-800/50" />
        <div className="h-48 rounded-xl bg-slate-800/50" />
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">Challenge not found</p>
        <Button variant="ghost" onClick={onBack} className="mt-4 text-slate-400">
          Go back
        </Button>
      </div>
    );
  }

  const isParticipant = !!challenge.my_participation;
  const canLog = isParticipant && challenge.status === 'active';
  const canJoin = !isParticipant && challenge.status !== 'completed' && (challenge.is_open || false);

  const myProgress = challenge.my_participation?.goal_completion_pct || 0;
  const today = new Date().toISOString().split('T')[0];
  const todayLogs = myLogs.filter(l => l.log_date === today);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-slate-800 transition-all"
        >
          <ArrowLeft className="w-5 h-5 text-slate-400" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {challenge.template?.icon && (
              <span className="text-xl">{challenge.template.icon}</span>
            )}
            <h2 className="text-lg font-bold text-white">{challenge.name}</h2>
          </div>
          {challenge.description && (
            <p className="text-xs text-slate-500 mt-0.5">{challenge.description}</p>
          )}
        </div>
        <Badge
          variant="outline"
          className={
            challenge.status === 'active'
              ? 'bg-green-500/20 text-green-400 border-green-500/30'
              : challenge.status === 'scheduled'
              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
          }
        >
          {challenge.status === 'active' ? 'Active' : challenge.status === 'scheduled' ? 'Upcoming' : 'Completed'}
        </Badge>
      </div>

      {/* My Stats Card (for participants) */}
      {isParticipant && (
        <Card className="border-indigo-500/20 bg-gradient-to-br from-indigo-500/10 to-purple-500/10">
          <CardContent className="p-4">
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-xl font-bold text-white">
                  {(challenge.my_participation?.cumulative_total || 0).toLocaleString()}
                </div>
                <div className="text-[10px] text-slate-400">{challenge.unit} total</div>
              </div>
              <div>
                <div className="text-xl font-bold text-indigo-400">
                  #{challenge.my_participation?.rank || '-'}
                </div>
                <div className="text-[10px] text-slate-400">rank</div>
              </div>
              <div>
                <div className="text-xl font-bold text-orange-400 flex items-center justify-center gap-1">
                  <Flame className="w-4 h-4" />
                  {challenge.my_participation?.current_streak || 0}
                </div>
                <div className="text-[10px] text-slate-400">streak</div>
              </div>
              <div>
                <div className="text-xl font-bold text-green-400">
                  {Math.round(myProgress)}%
                </div>
                <div className="text-[10px] text-slate-400">of goal</div>
              </div>
            </div>
            <Progress value={myProgress} className="h-1.5 mt-3 bg-slate-800" />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>{(challenge.my_participation?.cumulative_total || 0).toLocaleString()} {challenge.unit}</span>
              <span>{challenge.goal_amount.toLocaleString()} {challenge.unit}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Challenge Info Bar */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {challenge.participant_count} participants
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            {challenge.duration_days}d challenge
          </span>
          {challenge.status === 'active' && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              {challenge.days_remaining}d left
            </span>
          )}
        </div>
        <span className="flex items-center gap-1">
          <Target className="w-3.5 h-3.5" />
          {challenge.goal_amount.toLocaleString()} {challenge.unit}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1">
        {(['leaderboard', 'activity', 'details'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            {tab === 'leaderboard' ? 'Leaderboard' : tab === 'activity' ? 'My Activity' : 'Details'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'leaderboard' && (
        <ChallengeLeaderboard
          challenge={challenge}
          circleId={circleId}
        />
      )}

      {activeTab === 'activity' && (
        <div className="space-y-3">
          {myLogs.length === 0 ? (
            <div className="text-center py-8">
              <Target className="w-10 h-10 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No activity logged yet</p>
              {canLog && (
                <Button
                  onClick={() => setShowLogSheet(true)}
                  className="mt-3 bg-indigo-500 hover:bg-indigo-600 text-white"
                  size="sm"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Log your first activity
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Group by date */}
              {Object.entries(
                myLogs.reduce((groups: Record<string, CircleChallengeLog[]>, log) => {
                  const date = log.log_date;
                  if (!groups[date]) groups[date] = [];
                  groups[date].push(log);
                  return groups;
                }, {})
              ).map(([date, logs]) => (
                <div key={date}>
                  <h4 className="text-xs font-medium text-slate-500 mb-2">
                    {date === today
                      ? 'Today'
                      : new Date(date).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                    <span className="ml-2 text-slate-600">
                      ({logs.reduce((sum, l) => sum + l.amount, 0).toLocaleString()} {challenge.unit})
                    </span>
                  </h4>
                  {logs.map(log => (
                    <div
                      key={log.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 mb-1.5"
                    >
                      <div className="flex-1">
                        <span className="text-sm font-medium text-white">
                          +{log.amount.toLocaleString()} {challenge.unit}
                        </span>
                        {log.note && (
                          <p className="text-xs text-slate-500 mt-0.5">{log.note}</p>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">
                        {new Date(log.logged_at).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {log.log_date === today && (
                        <button
                          onClick={() => handleDeleteLog(log.id)}
                          className="p-1 rounded hover:bg-slate-700 transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-slate-500 hover:text-red-400" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {activeTab === 'details' && (
        <div className="space-y-3">
          <Card className="border-slate-700/50 bg-slate-800/30">
            <CardContent className="p-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Category</span>
                <span className="text-white capitalize">{challenge.category}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Goal</span>
                <span className="text-white">{challenge.goal_amount.toLocaleString()} {challenge.unit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Duration</span>
                <span className="text-white">{challenge.duration_days} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Starts</span>
                <span className="text-white">{new Date(challenge.starts_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ends</span>
                <span className="text-white">{new Date(challenge.ends_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Created by</span>
                <span className="text-white">{challenge.creator_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Open to join</span>
                <span className="text-white">{challenge.is_open ? 'Yes' : 'Invite only'}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* FAB: Log Activity */}
      {canLog && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="fixed bottom-6 right-6 z-50"
        >
          <Button
            onClick={() => setShowLogSheet(true)}
            className="rounded-full w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 shadow-xl shadow-indigo-500/25"
          >
            <Plus className="w-6 h-6" />
          </Button>
        </motion.div>
      )}

      {/* Join CTA */}
      {canJoin && (
        <div className="fixed bottom-6 left-6 right-6 z-50">
          <Button
            onClick={handleJoin}
            disabled={joining}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white h-12 rounded-xl shadow-xl shadow-indigo-500/25"
          >
            <UserPlus className="w-5 h-5 mr-2" />
            {joining ? 'Joining...' : 'Join This Challenge'}
          </Button>
        </div>
      )}

      {/* Log Activity Sheet */}
      {challenge && (
        <LogActivitySheet
          isOpen={showLogSheet}
          onClose={() => setShowLogSheet(false)}
          challenge={challenge}
          circleId={circleId}
          onLogSuccess={handleLogSuccess}
        />
      )}
    </div>
  );
}

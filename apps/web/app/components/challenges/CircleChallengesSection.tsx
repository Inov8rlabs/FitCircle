'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Plus, Trophy, Flame } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import {
  CircleChallengeWithDetails,
  ChallengeListResponse,
} from '@/lib/types/circle-challenge';
import ChallengeCard from './ChallengeCard';
import ChallengeCreationWizard from './ChallengeCreationWizard';
import ChallengeDetailView from './ChallengeDetailView';

interface CircleChallengesSectionProps {
  circleId: string;
  circleMembers?: Array<{ user_id: string; display_name: string; avatar_url?: string }>;
}

export default function CircleChallengesSection({
  circleId,
  circleMembers = [],
}: CircleChallengesSectionProps) {
  const { user } = useAuthStore();
  const [challenges, setChallenges] = useState<ChallengeListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  const fetchChallenges = useCallback(async () => {
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/challenges`);
      const result = await response.json();
      if (result.success) {
        setChallenges(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch challenges:', err);
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  // If viewing a challenge detail
  if (selectedChallengeId) {
    return (
      <ChallengeDetailView
        challengeId={selectedChallengeId}
        circleId={circleId}
        onBack={() => {
          setSelectedChallengeId(null);
          fetchChallenges();
        }}
      />
    );
  }

  const allChallenges = challenges
    ? [...challenges.active, ...challenges.scheduled, ...challenges.completed]
    : [];

  const filteredChallenges =
    filter === 'all'
      ? allChallenges
      : filter === 'active'
      ? [...(challenges?.active || []), ...(challenges?.scheduled || [])]
      : challenges?.completed || [];

  const activeCount = (challenges?.active.length || 0) + (challenges?.scheduled.length || 0);

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-indigo-400" />
          <h3 className="text-base font-semibold text-white">Challenges</h3>
          {activeCount > 0 && (
            <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-xs">
              {activeCount} active
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreateWizard(true)}
          className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs h-8"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Create
        </Button>
      </div>

      {/* Filter tabs */}
      {allChallenges.length > 0 && (
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1">
          {(['all', 'active', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                filter === f
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {f === 'all' ? `All (${allChallenges.length})` : f === 'active' ? `Active (${activeCount})` : `Completed (${challenges?.completed.length || 0})`}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-24 rounded-xl bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && allChallenges.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-10 rounded-xl border border-dashed border-slate-700 bg-slate-800/20"
        >
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center mx-auto mb-4">
            <Trophy className="w-8 h-8 text-indigo-400" />
          </div>
          <h4 className="text-white font-semibold mb-1">No challenges yet</h4>
          <p className="text-sm text-slate-500 mb-4 max-w-xs mx-auto">
            Start a fitness challenge to compete with your circle. Pick from 20 templates or create your own.
          </p>
          <Button
            onClick={() => setShowCreateWizard(true)}
            className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white"
          >
            <Zap className="w-4 h-4 mr-2" />
            Start a Challenge
          </Button>
        </motion.div>
      )}

      {/* Challenge Cards */}
      {!loading && filteredChallenges.length > 0 && (
        <div className="space-y-3">
          {filteredChallenges.map((challenge, index) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              onClick={() => setSelectedChallengeId(challenge.id)}
              index={index}
            />
          ))}
        </div>
      )}

      {/* Creation Wizard */}
      <ChallengeCreationWizard
        isOpen={showCreateWizard}
        onClose={() => setShowCreateWizard(false)}
        onSuccess={() => {
          fetchChallenges();
        }}
        circleId={circleId}
        circleMembers={circleMembers}
      />
    </div>
  );
}

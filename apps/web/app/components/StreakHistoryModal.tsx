'use client';

/**
 * StreakHistoryModal Component
 *
 * Displays detailed streak information and check-in history
 * Opened when user clicks the streak card (not the CTA button)
 *
 * Features:
 * - Current streak stats (days, longest streak, freezes)
 * - Chronological list of all check-ins
 * - Detailed info for each check-in (weight, steps, mood, energy, notes)
 * - Manual/synced indicators
 * - Responsive design (modal on desktop, sheet on mobile)
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import {
  Flame,
  Trophy,
  Snowflake,
  Scale,
  Footprints,
  Smile,
  Zap,
  Calendar,
  Loader2,
  X,
  StickyNote,
  Smartphone,
  PenLine
} from 'lucide-react';
import { format } from 'date-fns';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { formatWeight, weightKgToDisplay, getWeightUnit } from '@/lib/utils/units';

interface EngagementStreak {
  current_streak: number;
  longest_streak: number;
  streak_freezes_available: number;
  paused: boolean;
  pause_end_date: string | null;
  last_engagement_date: string | null;
}

interface CheckInEntry {
  id: string;
  tracking_date: string;
  weight_kg?: number | null;
  steps?: number | null;
  mood_score?: number | null;
  energy_level?: number | null;
  notes?: string | null;
  steps_source?: 'manual' | 'healthkit' | 'google_fit' | null;
  created_at: string;
}

interface StreakHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: string;
}

// Mood emojis mapping
const MOOD_EMOJIS: Record<number, string> = {
  1: '😫', 2: '😔', 3: '😕', 4: '😐',
  5: '🙂', 6: '😊', 7: '😁', 8: '🤩',
  9: '🎉', 10: '🔥',
};

export function StreakHistoryModal({ isOpen, onClose, userId }: StreakHistoryModalProps) {
  const [streak, setStreak] = useState<EngagementStreak | null>(null);
  const [checkIns, setCheckIns] = useState<CheckInEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { unitSystem } = useUnitPreference();

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, userId]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch streak info
      const streakResponse = await fetch('/api/streaks/engagement', {
        credentials: 'include',
      });
      if (streakResponse.ok) {
        const streakData = await streakResponse.json();
        setStreak(streakData);
      }

      // Fetch check-in history
      const checkInsResponse = await fetch('/api/mobile/tracking/daily?limit=100', {
        credentials: 'include',
      });
      if (checkInsResponse.ok) {
        const checkInsData = await checkInsResponse.json();
        setCheckIns(checkInsData.data || []);
      }
    } catch (error) {
      console.error('Error fetching streak history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getSourceLabel = (source?: 'manual' | 'healthkit' | 'google_fit' | null) => {
    if (!source || source === 'manual') return 'Manual';
    if (source === 'healthkit') return 'HealthKit';
    if (source === 'google_fit') return 'Google Fit';
    return 'Manual';
  };

  const getSourceIcon = (source?: 'manual' | 'healthkit' | 'google_fit' | null) => {
    if (!source || source === 'manual') return PenLine;
    return Smartphone;
  };

  const content = (
    <div className="space-y-6">
      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
        </div>
      )}

      {!isLoading && (
        <>
          {/* Streak Summary Cards */}
          {streak && (
            <div className="grid grid-cols-3 gap-3 sm:gap-4">
              {/* Current Streak */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4 text-center">
                  <Flame className="h-6 w-6 sm:h-8 sm:w-8 text-orange-400 mx-auto mb-2" />
                  <p className="text-2xl sm:text-3xl font-bold text-white mb-1">
                    {streak.current_streak}
                  </p>
                  <p className="text-xs text-gray-400">Current Streak</p>
                </CardContent>
              </Card>

              {/* Longest Streak */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4 text-center">
                  <Trophy className="h-6 w-6 sm:h-8 sm:w-8 text-yellow-400 mx-auto mb-2" />
                  <p className="text-2xl sm:text-3xl font-bold text-white mb-1">
                    {streak.longest_streak}
                  </p>
                  <p className="text-xs text-gray-400">Best Streak</p>
                </CardContent>
              </Card>

              {/* Freezes Available */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4 text-center">
                  <Snowflake className="h-6 w-6 sm:h-8 sm:w-8 text-cyan-400 mx-auto mb-2" />
                  <p className="text-2xl sm:text-3xl font-bold text-white mb-1">
                    {streak.streak_freezes_available}
                  </p>
                  <p className="text-xs text-gray-400">Freezes</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Check-In History */}
          <div>
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Calendar className="h-5 w-5 text-indigo-400" />
              Check-In History
            </h3>

            {checkIns.length === 0 ? (
              <div className="text-center py-12">
                <Calendar className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No check-ins yet</p>
                <p className="text-sm text-gray-500 mt-1">
                  Start logging your progress to build your streak
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {checkIns.map((checkIn, index) => {
                  const date = new Date(checkIn.tracking_date);
                  const dateStr = format(date, 'MMM d, yyyy');
                  const timeStr = format(new Date(checkIn.created_at), 'h:mm a');
                  const hasWeight = checkIn.weight_kg !== null && checkIn.weight_kg !== undefined;
                  const hasSteps = checkIn.steps !== null && checkIn.steps !== undefined;
                  const hasMood = checkIn.mood_score !== null && checkIn.mood_score !== undefined;
                  const hasEnergy = checkIn.energy_level !== null && checkIn.energy_level !== undefined;
                  const hasNotes = checkIn.notes && checkIn.notes.trim().length > 0;

                  const SourceIcon = getSourceIcon(checkIn.steps_source);

                  return (
                    <motion.div
                      key={checkIn.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card className="bg-slate-800/30 border-slate-700 hover:bg-slate-800/50 transition-colors">
                        <CardContent className="p-4">
                          {/* Date Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <p className="text-sm font-semibold text-white">{dateStr}</p>
                              <p className="text-xs text-gray-400">{timeStr}</p>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <Calendar className="h-3 w-3" />
                              <span>Day {checkIns.length - index}</span>
                            </div>
                          </div>

                          {/* Data Grid */}
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            {/* Weight */}
                            {hasWeight && (
                              <div className="flex items-start gap-2">
                                <Scale className="h-4 w-4 text-purple-400 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs text-gray-400">Weight</p>
                                  <p className="text-sm font-semibold text-white">
                                    {formatWeight(checkIn.weight_kg, unitSystem)}
                                  </p>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <PenLine className="h-3 w-3 text-gray-500" />
                                    <span className="text-xs text-gray-500">Manual</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Steps */}
                            {hasSteps && (
                              <div className="flex items-start gap-2">
                                <Footprints className="h-4 w-4 text-indigo-400 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs text-gray-400">Steps</p>
                                  <p className="text-sm font-semibold text-white">
                                    {checkIn.steps!.toLocaleString()}
                                  </p>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <SourceIcon className="h-3 w-3 text-gray-500" />
                                    <span className="text-xs text-gray-500">
                                      {getSourceLabel(checkIn.steps_source)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Mood */}
                            {hasMood && (
                              <div className="flex items-start gap-2">
                                <Smile className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs text-gray-400">Mood</p>
                                  <p className="text-sm font-semibold text-white">
                                    {MOOD_EMOJIS[checkIn.mood_score!]} {checkIn.mood_score}/10
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Energy */}
                            {hasEnergy && (
                              <div className="flex items-start gap-2">
                                <Zap className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs text-gray-400">Energy</p>
                                  <p className="text-sm font-semibold text-white">
                                    {'⚡'.repeat(Math.ceil(checkIn.energy_level! / 2))} {checkIn.energy_level}/10
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Notes */}
                          {hasNotes && (
                            <div className="pt-3 border-t border-slate-700/50">
                              <div className="flex items-start gap-2">
                                <StickyNote className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                <div>
                                  <p className="text-xs text-gray-400 mb-1">Notes</p>
                                  <p className="text-sm text-gray-300">{checkIn.notes}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Empty State for Check-In with No Data */}
                          {!hasWeight && !hasSteps && !hasMood && !hasEnergy && !hasNotes && (
                            <p className="text-sm text-gray-500 italic">No data logged</p>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2 text-xl">
            <Flame className="h-6 w-6 text-orange-400" />
            Streak Details
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            View your engagement streak and check-in history
          </DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

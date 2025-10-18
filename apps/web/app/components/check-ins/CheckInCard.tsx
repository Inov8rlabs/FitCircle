'use client';

/**
 * CheckInCard Component
 *
 * Displays a check-in in the progress history list with visual distinction
 * based on type (weight, steps, or mixed).
 *
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { motion } from 'framer-motion';
import { Scale, Footprints, Activity, ChevronRight, Lock, Globe } from 'lucide-react';
import { format } from 'date-fns';
import { CheckIn } from '@/lib/services/check-in-service';

// Color system from PRD
const CHECK_IN_COLORS = {
  weight: {
    background: 'bg-gradient-to-br from-purple-500/10 to-purple-600/5',
    border: 'border-purple-500/30',
    icon: 'text-purple-400',
    accent: 'text-purple-300',
  },
  steps: {
    background: 'bg-gradient-to-br from-indigo-500/10 to-indigo-600/5',
    border: 'border-indigo-500/30',
    icon: 'text-indigo-400',
    accent: 'text-indigo-300',
  },
  mixed: {
    background: 'bg-gradient-to-r from-purple-500/10 via-slate-900/50 to-indigo-500/10',
    border: 'border-purple-500/20 border-r-indigo-500/20',
    icon: 'text-slate-300',
    accent: 'text-slate-200',
  },
};

// Mood emojis mapping
const MOOD_EMOJIS: Record<number, string> = {
  1: '😫', 2: '😔', 3: '😕', 4: '😐',
  5: '🙂', 6: '😊', 7: '😁', 8: '🤩',
  9: '🎉', 10: '🔥',
};

interface CheckInCardProps {
  checkIn: CheckIn;
  onClick: () => void;
  compact?: boolean;
  previousCheckIn?: CheckIn | null;
}

export function CheckInCard({
  checkIn,
  onClick,
  compact = false,
  previousCheckIn,
}: CheckInCardProps) {
  // Determine check-in type
  const hasWeight = checkIn.weight_kg !== null;
  const hasSteps = checkIn.steps !== null;
  const type = hasWeight && hasSteps ? 'mixed' : hasWeight ? 'weight' : 'steps';

  const colors = CHECK_IN_COLORS[type];

  // Calculate delta from previous check-in
  const weightDelta = previousCheckIn && hasWeight && previousCheckIn.weight_kg
    ? checkIn.weight_kg! - previousCheckIn.weight_kg
    : null;

  const stepsDelta = previousCheckIn && hasSteps && previousCheckIn.steps
    ? checkIn.steps! - previousCheckIn.steps
    : null;

  // Format date
  const date = new Date(checkIn.tracking_date);
  const dateStr = format(date, 'MMM d, yyyy');
  const timeStr = format(new Date(checkIn.created_at), 'h:mm a');

  // Get icon based on type
  const Icon = type === 'weight' ? Scale : type === 'steps' ? Footprints : Activity;

  // Mood emoji
  const moodEmoji = checkIn.mood_score ? MOOD_EMOJIS[checkIn.mood_score] : null;

  // Energy level (lightning bolts)
  const energyBolts = checkIn.energy_level
    ? '⚡'.repeat(Math.ceil(checkIn.energy_level / 2))
    : null;

  return (
    <motion.div
      className={`
        ${colors.background} ${colors.border}
        border rounded-xl p-4 sm:p-5 cursor-pointer
        transition-all duration-200
        hover:scale-[1.02] active:scale-[0.98]
        shadow-lg shadow-black/20
        ${compact ? 'p-3' : ''}
      `}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
    >
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${colors.icon}`} />
            <div>
              <p className="text-sm font-semibold tracking-wide uppercase">
                {type === 'weight' && 'Weight Check-In'}
                {type === 'steps' && 'Steps Check-In'}
                {type === 'mixed' && 'Daily Check-In'}
              </p>
              <p className="text-xs text-slate-400">
                {dateStr} • {timeStr}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!checkIn.is_public && (
              <Lock className="h-4 w-4 text-slate-500" />
            )}
            {checkIn.is_public && (
              <Globe className="h-4 w-4 text-slate-500" />
            )}
            <ChevronRight className={`h-5 w-5 ${colors.icon} transition-transform group-hover:translate-x-1`} />
          </div>
        </div>

        {/* Main Values */}
        <div className="flex items-baseline gap-4">
          {/* Weight */}
          {hasWeight && (
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl sm:text-3xl font-bold ${colors.accent}`}>
                  {checkIn.weight_kg!.toFixed(1)}
                </span>
                <span className="text-lg text-slate-400">kg</span>
              </div>
              {weightDelta !== null && (
                <p className={`text-sm font-medium ${
                  weightDelta < 0 ? 'text-green-400' : weightDelta > 0 ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {weightDelta < 0 ? '↓' : weightDelta > 0 ? '↑' : '→'} {Math.abs(weightDelta).toFixed(1)} kg
                  {' from yesterday'}
                </p>
              )}
            </div>
          )}

          {/* Steps */}
          {hasSteps && (
            <div className="flex-1">
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl sm:text-3xl font-bold ${colors.accent}`}>
                  {checkIn.steps!.toLocaleString()}
                </span>
                <span className="text-sm text-slate-400">steps</span>
              </div>
              {stepsDelta !== null && (
                <p className={`text-sm font-medium ${
                  stepsDelta > 0 ? 'text-green-400' : stepsDelta < 0 ? 'text-red-400' : 'text-slate-400'
                }`}>
                  {stepsDelta > 0 ? '↑' : stepsDelta < 0 ? '↓' : '→'} {Math.abs(stepsDelta).toLocaleString()} steps
                </p>
              )}
            </div>
          )}
        </div>

        {/* Mood, Energy, Notes */}
        {!compact && (moodEmoji || energyBolts || checkIn.notes) && (
          <div className="flex items-center gap-4 pt-2 border-t border-slate-700/50">
            {moodEmoji && (
              <div className="flex items-center gap-1">
                <span className="text-lg">{moodEmoji}</span>
                <span className="text-xs text-slate-400">Mood</span>
              </div>
            )}
            {energyBolts && (
              <div className="flex items-center gap-1">
                <span className="text-sm">{energyBolts}</span>
                <span className="text-xs text-slate-400">Energy</span>
              </div>
            )}
            {checkIn.notes && (
              <p className="text-sm text-slate-300 line-clamp-1 flex-1">
                "{checkIn.notes}"
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

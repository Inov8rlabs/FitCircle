'use client';

/**
 * CheckInDetailSheet Component
 *
 * Mobile bottom sheet for displaying full check-in details
 * Optimized for touch interactions with swipe-to-dismiss
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { useState } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Scale,
  Footprints,
  Edit,
  Trash,
  Lock,
  Globe,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { format } from 'date-fns';
import { CheckInWithProfile } from '@/lib/services/check-in-service';
import { toast } from 'sonner';

// Mood mapping (same as modal)
const MOOD_MAP: Record<number, { emoji: string; label: string; color: string }> = {
  1: { emoji: '😫', label: 'Terrible', color: 'text-red-400' },
  2: { emoji: '😔', label: 'Bad', color: 'text-red-400' },
  3: { emoji: '😕', label: 'Poor', color: 'text-orange-400' },
  4: { emoji: '😐', label: 'Below Average', color: 'text-yellow-400' },
  5: { emoji: '🙂', label: 'Okay', color: 'text-yellow-400' },
  6: { emoji: '😊', label: 'Good', color: 'text-green-400' },
  7: { emoji: '😁', label: 'Great', color: 'text-green-400' },
  8: { emoji: '🤩', label: 'Amazing', color: 'text-green-400' },
  9: { emoji: '🎉', label: 'Fantastic', color: 'text-green-400' },
  10: { emoji: '🔥', label: 'On Fire!', color: 'text-green-400' },
};

const ENERGY_MAP: Record<number, string> = {
  1: 'Very Low', 2: 'Low', 3: 'Low', 4: 'Below Average',
  5: 'Moderate', 6: 'Moderate', 7: 'High', 8: 'High',
  9: 'Very High', 10: 'Maximum',
};

interface CheckInDetailSheetProps {
  checkIn: CheckInWithProfile | null;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  onEdit?: () => void;
  onDelete?: () => Promise<void>;
  onTogglePrivacy?: (isPublic: boolean) => Promise<void>;
  previousCheckIn?: CheckInWithProfile | null;
  challengeContext?: {
    name: string;
    startValue?: number;
    currentValue?: number;
    goalValue?: number;
    streak?: number;
  };
}

export function CheckInDetailSheet({
  checkIn,
  isOpen,
  onClose,
  canEdit,
  onEdit,
  onDelete,
  onTogglePrivacy,
  previousCheckIn,
  challengeContext,
}: CheckInDetailSheetProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTogglingPrivacy, setIsTogglingPrivacy] = useState(false);

  if (!checkIn) return null;

  const hasWeight = checkIn.weight_kg !== null;
  const hasSteps = checkIn.steps !== null;

  // Calculate deltas
  const weightDelta = previousCheckIn && hasWeight && previousCheckIn.weight_kg
    ? checkIn.weight_kg! - previousCheckIn.weight_kg
    : null;

  const stepsDelta = previousCheckIn && hasSteps && previousCheckIn.steps
    ? checkIn.steps! - previousCheckIn.steps
    : null;

  // Format date
  const date = new Date(checkIn.tracking_date);
  const dateStr = format(date, 'EEEE, MMM d, yyyy');
  const timeStr = format(new Date(checkIn.created_at), 'h:mm a');

  // Mood/Energy data
  const moodData = checkIn.mood_score ? MOOD_MAP[checkIn.mood_score] : null;
  const energyLabel = checkIn.energy_level ? ENERGY_MAP[checkIn.energy_level] : null;

  // Handle delete
  const handleDelete = async () => {
    if (!onDelete) return;

    const confirmed = confirm('Are you sure you want to delete this check-in? This cannot be undone.');
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete();
      toast.success('Check-in deleted successfully');
      onClose();
    } catch (error) {
      toast.error('Failed to delete check-in');
    } finally {
      setIsDeleting(false);
    }
  };

  // Handle privacy toggle
  const handleTogglePrivacy = async () => {
    if (!onTogglePrivacy) return;

    setIsTogglingPrivacy(true);
    try {
      await onTogglePrivacy(!checkIn.is_public);
      toast.success(checkIn.is_public ? 'Check-in is now private' : 'Check-in is now public');
    } catch (error) {
      toast.error('Failed to update privacy setting');
    } finally {
      setIsTogglingPrivacy(false);
    }
  };

  // Handle drag to dismiss
  const handleDragEnd = (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (info.offset.y > 100) {
      onClose();
    }
  };

  // Sheet animation variants
  const sheetVariants = {
    hidden: { y: '100%' },
    visible: {
      y: 0,
      transition: {
        type: 'spring',
        damping: 30,
        stiffness: 300,
      },
    },
    exit: {
      y: '100%',
      transition: { duration: 0.25, ease: 'easeInOut' },
    },
  };

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/50 z-40"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={onClose}
          />

          {/* Bottom Sheet */}
          <motion.div
            className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900 rounded-t-3xl max-h-[90vh] overflow-y-auto"
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
          >
            {/* Pull Handle */}
            <div className="flex justify-center py-3 sticky top-0 bg-slate-900 z-10">
              <div className="w-12 h-1.5 bg-slate-600 rounded-full" />
            </div>

            {/* Content */}
            <div className="px-4 pb-6 space-y-4">
              {/* Header */}
              <div>
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {hasWeight && <Scale className="h-5 w-5 text-purple-400" />}
                    {hasSteps && !hasWeight && <Footprints className="h-5 w-5 text-indigo-400" />}
                    <h2 className="text-lg font-semibold">
                      {hasWeight && hasSteps ? 'Daily Check-In' : hasWeight ? 'Weight Check-In' : 'Steps Check-In'}
                    </h2>
                  </div>
                  {canEdit && (
                    <Badge variant={checkIn.is_public ? 'default' : 'secondary'} className="gap-1">
                      {checkIn.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                      {checkIn.is_public ? 'Public' : 'Private'}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-slate-400">
                  {dateStr} • {timeStr}
                </p>
              </div>

              {/* Main Metrics */}
              <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                <div className="space-y-4">
                  {/* Weight */}
                  {hasWeight && (
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Weight</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-purple-300">
                          {checkIn.weight_kg!.toFixed(1)}
                        </span>
                        <span className="text-lg text-purple-400/70">kg</span>
                      </div>
                      {weightDelta !== null && (
                        <div className={`flex items-center gap-1 mt-1 text-sm font-medium ${
                          weightDelta < 0 ? 'text-green-400' : weightDelta > 0 ? 'text-red-400' : 'text-slate-400'
                        }`}>
                          {weightDelta < 0 ? <TrendingDown className="h-3 w-3" /> : weightDelta > 0 ? <TrendingUp className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                          {Math.abs(weightDelta).toFixed(1)} kg from yesterday
                        </div>
                      )}
                    </div>
                  )}

                  {/* Steps */}
                  {hasSteps && (
                    <div className={hasWeight ? 'pt-4 border-t border-slate-700' : ''}>
                      <p className="text-xs text-slate-400 mb-1">Steps</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-indigo-300">
                          {checkIn.steps!.toLocaleString()}
                        </span>
                        <span className="text-base text-indigo-400/70">steps</span>
                      </div>
                      {stepsDelta !== null && (
                        <div className={`flex items-center gap-1 mt-1 text-sm text-indigo-400`}>
                          {stepsDelta > 0 ? <TrendingUp className="h-3 w-3" /> : stepsDelta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                          {stepsDelta > 0 ? '+' : ''}{stepsDelta.toLocaleString()} from yesterday
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Mood & Energy */}
              {(moodData || energyLabel) && (
                <div className="grid grid-cols-2 gap-3">
                  {/* Mood */}
                  {moodData && (
                    <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                      <p className="text-xs text-slate-400 mb-2">Mood</p>
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{moodData.emoji}</span>
                        <div>
                          <p className={`text-sm font-medium ${moodData.color}`}>{moodData.label}</p>
                          <p className="text-xs text-slate-400">{checkIn.mood_score}/10</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Energy */}
                  {energyLabel && (
                    <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                      <p className="text-xs text-slate-400 mb-2">Energy</p>
                      <div>
                        <p className="text-sm font-medium text-orange-400">{energyLabel}</p>
                        <div className="flex gap-0.5 mt-2">
                          {Array.from({ length: 10 }).map((_, i) => (
                            <div
                              key={i}
                              className={`h-1.5 w-1.5 rounded-full ${
                                i < checkIn.energy_level! ? 'bg-orange-400' : 'bg-slate-600'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {checkIn.notes && (
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <p className="text-xs text-slate-400 mb-2">📝 Notes</p>
                  <p className="text-sm text-slate-200 leading-relaxed">{checkIn.notes}</p>
                </div>
              )}

              {/* Progress Context */}
              {challengeContext && (
                <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <p className="text-xs text-slate-400 mb-2">📊 Progress in {challengeContext.name}</p>
                  {challengeContext.startValue && challengeContext.goalValue && (
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Start:</span>
                        <span className="font-medium">{challengeContext.startValue} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Current:</span>
                        <span className="font-medium text-purple-300">{challengeContext.currentValue} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Goal:</span>
                        <span className="font-medium">{challengeContext.goalValue} kg</span>
                      </div>
                    </div>
                  )}
                  {challengeContext.streak && (
                    <p className="text-xs mt-2">
                      Streak: <span className="font-bold text-orange-400">🔥 {challengeContext.streak} days</span>
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              {canEdit && (
                <div className="grid grid-cols-2 gap-2 pt-2">
                  {onEdit && (
                    <Button variant="outline" onClick={onEdit} className="gap-2 h-11">
                      <Edit className="h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  {onTogglePrivacy && (
                    <Button
                      variant="outline"
                      onClick={handleTogglePrivacy}
                      disabled={isTogglingPrivacy}
                      className="gap-2 h-11"
                    >
                      {checkIn.is_public ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                      {isTogglingPrivacy ? 'Updating...' : checkIn.is_public ? 'Make Private' : 'Make Public'}
                    </Button>
                  )}
                  {onDelete && (
                    <Button
                      variant="ghost"
                      onClick={handleDelete}
                      disabled={isDeleting}
                      className="gap-2 h-11 text-red-400 hover:text-red-300 col-span-2"
                    >
                      <Trash className="h-4 w-4" />
                      {isDeleting ? 'Deleting...' : 'Delete Check-In'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

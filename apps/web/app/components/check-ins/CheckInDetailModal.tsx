'use client';

/**
 * CheckInDetailModal Component
 *
 * Desktop modal for displaying full check-in details with edit/delete actions
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Scale,
  Footprints,
  Edit,
  Trash,
  Lock,
  Globe,
  X,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { format } from 'date-fns';
import { CheckInWithProfile } from '@/lib/services/check-in-service';
import { toast } from 'sonner';

// Mood mapping
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

interface CheckInDetailModalProps {
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

export function CheckInDetailModal({
  checkIn,
  isOpen,
  onClose,
  canEdit,
  onEdit,
  onDelete,
  onTogglePrivacy,
  previousCheckIn,
  challengeContext,
}: CheckInDetailModalProps) {
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
  const dateStr = format(date, 'EEEE, MMMM d, yyyy');
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

  // Modal animation variants
  const modalVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        type: 'spring',
        damping: 25,
        stiffness: 300,
        duration: 0.3,
      },
    },
    exit: {
      opacity: 0,
      scale: 0.95,
      y: 20,
      transition: { duration: 0.2 },
    },
  };

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900/95 backdrop-blur-xl border-slate-800">
        <AnimatePresence mode="wait">
          {isOpen && (
            <motion.div
              variants={modalVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                      {hasWeight && <Scale className="h-5 w-5 text-purple-400" />}
                      {hasSteps && !hasWeight && <Footprints className="h-5 w-5 text-indigo-400" />}
                      {hasWeight && hasSteps ? 'Daily Check-In' : hasWeight ? 'Weight Check-In' : 'Steps Check-In'}
                    </DialogTitle>
                    <p className="text-sm text-slate-400 mt-1">
                      {dateStr} • {timeStr}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-2">
                      <Badge variant={checkIn.is_public ? 'default' : 'secondary'} className="gap-1">
                        {checkIn.is_public ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {checkIn.is_public ? 'Public' : 'Private'}
                      </Badge>
                    </div>
                  )}
                </div>
              </DialogHeader>

              <motion.div
                className="space-y-6 mt-6"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {/* Main Metrics */}
                <motion.div variants={itemVariants} className="p-6 bg-slate-800/50 rounded-lg border border-slate-700">
                  <div className="grid grid-cols-2 gap-6">
                    {/* Weight */}
                    {hasWeight && (
                      <div>
                        <p className="text-sm text-slate-400 mb-2">Weight</p>
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-bold text-purple-300">
                            {checkIn.weight_kg!.toFixed(1)}
                          </span>
                          <span className="text-xl text-purple-400/70">kg</span>
                        </div>
                        {weightDelta !== null && (
                          <div className={`flex items-center gap-1 mt-2 text-base font-medium ${
                            weightDelta < 0 ? 'text-green-400' : weightDelta > 0 ? 'text-red-400' : 'text-slate-400'
                          }`}>
                            {weightDelta < 0 ? <TrendingDown className="h-4 w-4" /> : weightDelta > 0 ? <TrendingUp className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                            {Math.abs(weightDelta).toFixed(1)} kg from yesterday
                          </div>
                        )}
                      </div>
                    )}

                    {/* Steps */}
                    {hasSteps && (
                      <div>
                        <p className="text-sm text-slate-400 mb-2">Steps</p>
                        <div className="flex items-baseline gap-2">
                          <span className="text-3xl font-bold text-indigo-300">
                            {checkIn.steps!.toLocaleString()}
                          </span>
                          <span className="text-lg text-indigo-400/70">steps</span>
                        </div>
                        {stepsDelta !== null && (
                          <div className={`flex items-center gap-1 mt-2 text-base text-indigo-400`}>
                            {stepsDelta > 0 ? <TrendingUp className="h-4 w-4" /> : stepsDelta < 0 ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                            {stepsDelta > 0 ? '+' : ''}{stepsDelta.toLocaleString()} from yesterday
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>

                {/* Mood & Energy */}
                {(moodData || energyLabel) && (
                  <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4">
                    {/* Mood */}
                    {moodData && (
                      <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                        <p className="text-sm text-slate-400 mb-2">Mood</p>
                        <div className="flex items-center gap-3">
                          <span className="text-3xl">{moodData.emoji}</span>
                          <div>
                            <p className={`font-medium ${moodData.color}`}>{moodData.label}</p>
                            <p className="text-xs text-slate-400">{checkIn.mood_score}/10</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Energy */}
                    {energyLabel && (
                      <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                        <p className="text-sm text-slate-400 mb-2">Energy</p>
                        <div>
                          <p className="font-medium text-orange-400">{energyLabel}</p>
                          <div className="flex gap-0.5 mt-2">
                            {Array.from({ length: 10 }).map((_, i) => (
                              <div
                                key={i}
                                className={`h-2 w-2 rounded-full ${
                                  i < checkIn.energy_level! ? 'bg-orange-400' : 'bg-slate-600'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Notes */}
                {checkIn.notes && (
                  <motion.div variants={itemVariants} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                    <p className="text-sm text-slate-400 mb-2">📝 Notes</p>
                    <p className="text-base text-slate-200 leading-relaxed">{checkIn.notes}</p>
                  </motion.div>
                )}

                {/* Progress Context (if provided) */}
                {challengeContext && (
                  <motion.div variants={itemVariants} className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                    <p className="text-sm text-slate-400 mb-3">📊 Progress in {challengeContext.name}</p>
                    {challengeContext.startValue && challengeContext.goalValue && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Start:</span>
                          <span className="font-medium">{challengeContext.startValue} kg</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Current:</span>
                          <span className="font-medium text-purple-300">{challengeContext.currentValue} kg</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Goal:</span>
                          <span className="font-medium">{challengeContext.goalValue} kg</span>
                        </div>
                      </div>
                    )}
                    {challengeContext.streak && (
                      <p className="text-sm mt-3">
                        Streak: <span className="font-bold text-orange-400">🔥 {challengeContext.streak} days</span>
                      </p>
                    )}
                  </motion.div>
                )}

                {/* User Info (if viewing others' check-in) */}
                {!canEdit && (
                  <motion.div variants={itemVariants} className="text-xs text-slate-500 text-right">
                    Posted by {checkIn.profile.display_name}
                  </motion.div>
                )}

                {/* Actions */}
                {canEdit && (
                  <motion.div variants={itemVariants} className="flex gap-2 border-t border-slate-800 pt-4">
                    {onEdit && (
                      <Button variant="outline" onClick={onEdit} className="gap-2">
                        <Edit className="h-4 w-4" />
                        Edit
                      </Button>
                    )}
                    {onTogglePrivacy && (
                      <Button
                        variant="outline"
                        onClick={handleTogglePrivacy}
                        disabled={isTogglingPrivacy}
                        className="gap-2"
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
                        className="gap-2 text-red-400 hover:text-red-300 ml-auto"
                      >
                        <Trash className="h-4 w-4" />
                        {isDeleting ? 'Deleting...' : 'Delete'}
                      </Button>
                    )}
                  </motion.div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

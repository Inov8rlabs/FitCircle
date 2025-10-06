'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, TrendingDown, TrendingUp, Sparkles, Save, X, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface GoalProgressIndicatorProps {
  currentWeight?: number | null;
  goalWeight?: number;
  startingWeight?: number;
  unit?: 'metric' | 'imperial';
  className?: string;
  onGoalSaved?: () => void;
}

export function GoalProgressIndicator({
  currentWeight,
  goalWeight,
  startingWeight,
  unit = 'metric',
  className = '',
  onGoalSaved
}: GoalProgressIndicatorProps) {
  const unitLabel = unit === 'metric' ? 'kg' : 'lbs';
  const [isSettingGoal, setIsSettingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveGoal = async () => {
    if (!goalInput) return;

    setIsSaving(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { useAuthStore } = await import('@/stores/auth-store');
      const { parseWeightToKg } = await import('@/lib/utils/units');

      const user = useAuthStore.getState().user;
      if (!user) throw new Error('No user found');

      const goalWeightKg = parseWeightToKg(parseFloat(goalInput), unit);

      // Get current goals
      const { data: profileData, error: fetchError } = (await supabase
        .from('profiles')
        .select('goals')
        .eq('id', user.id)
        .single()) as { data: any; error: any };

      if (fetchError) throw fetchError;

      const currentGoals = profileData?.goals || [];
      const otherGoals = Array.isArray(currentGoals)
        ? currentGoals.filter((g: any) => g.type !== 'weight')
        : [];

      // Check if there's an existing weight goal to preserve starting weight
      const existingWeightGoal = currentGoals.find((g: any) => g.type === 'weight');

      // Convert current weight back to kg if it's in display units
      let currentWeightKg = currentWeight;
      if (currentWeight && unit === 'imperial') {
        currentWeightKg = parseWeightToKg(currentWeight, unit);
      }

      const startingWeightKg = existingWeightGoal?.starting_weight_kg || currentWeightKg || goalWeightKg;

      const updatedGoals = [
        ...otherGoals,
        {
          type: 'weight',
          target_weight_kg: goalWeightKg,
          starting_weight_kg: startingWeightKg,
          created_at: existingWeightGoal?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ];

      const { error: updateError } = await (supabase
        .from('profiles') as any)
        .update({ goals: updatedGoals })
        .eq('id', user.id);

      if (updateError) throw updateError;

      const { toast } = await import('sonner');
      toast.success('Goal weight saved successfully!');
      setIsSettingGoal(false);
      setGoalInput('');

      // Trigger refresh
      if (onGoalSaved) onGoalSaved();
    } catch (error) {
      console.error('Error saving goal:', error);
      const { toast } = await import('sonner');
      toast.error('Failed to save goal weight');
    } finally {
      setIsSaving(false);
    }
  };

  // Show placeholder when no goal is set
  if (!goalWeight) {
    return (
      <Card className={`bg-gradient-to-br from-slate-900/50 to-slate-800/30 border-slate-700/50 backdrop-blur-xl overflow-hidden ${className}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-full bg-slate-700/50 flex items-center justify-center">
              <Target className="w-4 h-4 text-gray-500" />
            </div>
            <div>
              <h3 className="text-xs font-medium text-gray-400">Goal Progress</h3>
              <p className="text-xs text-gray-500">No goal set</p>
            </div>
          </div>

          {/* Inactive Progress Bar */}
          <div className="relative h-2 bg-slate-800/50 rounded-full mb-3 opacity-30">
            <div className="absolute inset-y-0 left-0 w-0 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" />
          </div>

          <AnimatePresence mode="wait">
            {!isSettingGoal ? (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center py-2"
              >
                <p className="text-xs text-gray-400 mb-3">
                  Track your weight loss progress
                </p>
                <Button
                  onClick={() => setIsSettingGoal(true)}
                  size="sm"
                  className="bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50"
                >
                  Set Your Goal
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div>
                  <Label htmlFor="goalWeightInput" className="text-sm font-medium text-gray-300 mb-2 block">
                    Target Weight ({unitLabel})
                  </Label>
                  <Input
                    id="goalWeightInput"
                    type="number"
                    step="0.1"
                    placeholder={unit === 'metric' ? 'e.g., 75' : 'e.g., 165'}
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveGoal}
                    disabled={isSaving || !goalInput}
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        Save Goal
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => {
                      setIsSettingGoal(false);
                      setGoalInput('');
                    }}
                    variant="outline"
                    className="bg-slate-800/50 border-slate-700 text-gray-300 hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    );
  }

  if (!currentWeight) {
    return null;
  }

  const difference = currentWeight - goalWeight;
  const absDifference = Math.abs(difference);
  const isAtGoal = Math.abs(difference) < 0.5; // Within 0.5 units of goal
  const isAboveGoal = difference > 0;

  // Calculate progress percentage based on starting weight
  // Progress = (Starting - Current) / (Starting - Goal) × 100
  let progressPercent = 0;
  if (startingWeight && startingWeight > goalWeight) {
    const totalToLose = startingWeight - goalWeight;
    const lostSoFar = startingWeight - currentWeight;
    progressPercent = Math.min(100, Math.max(0, (lostSoFar / totalToLose) * 100));
  } else {
    // Fallback if no starting weight: assume current weight is starting weight (0% progress)
    progressPercent = 0;
  }

  return (
    <Card className={`bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border-purple-500/30 backdrop-blur-xl overflow-hidden ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
            <Target className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h3 className="text-xs font-medium text-gray-400">Goal Progress</h3>
            <p className="text-sm font-bold text-white">
              Target: {goalWeight} {unitLabel}
            </p>
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="relative h-2 bg-slate-800/50 rounded-full overflow-hidden mb-3">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full"
          />
          {isAtGoal && (
            <motion.div
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className="absolute inset-0 flex items-center justify-center"
            >
              <Sparkles className="w-4 h-4 text-yellow-400" />
            </motion.div>
          )}
        </div>

        {/* Status Message */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAtGoal ? (
              <>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                >
                  <Sparkles className="w-5 h-5 text-yellow-400" />
                </motion.div>
                <span className="text-sm font-semibold text-yellow-400">
                  You've reached your goal! 🎉
                </span>
              </>
            ) : isAboveGoal ? (
              <>
                <TrendingDown className="w-5 h-5 text-orange-400" />
                <span className="text-sm text-gray-300">
                  <span className="font-bold text-orange-400">{absDifference.toFixed(1)} {unitLabel}</span> to go
                </span>
              </>
            ) : (
              <>
                <TrendingUp className="w-5 h-5 text-green-400" />
                <span className="text-sm text-gray-300">
                  <span className="font-bold text-green-400">{absDifference.toFixed(1)} {unitLabel}</span> below goal
                </span>
              </>
            )}
          </div>

          <div className="text-right">
            <p className="text-xs text-gray-500">Progress</p>
            <p className="text-lg font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
              {progressPercent.toFixed(0)}%
            </p>
          </div>
        </div>

        {/* Motivational Message */}
        {!isAtGoal && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="mt-2 pt-2 border-t border-purple-500/20"
          >
            <p className="text-xs text-gray-400 italic text-center">
              {isAboveGoal
                ? "Keep going! 💪"
                : "Great progress! ⭐"}
            </p>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

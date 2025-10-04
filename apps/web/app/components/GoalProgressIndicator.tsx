'use client';

import { motion } from 'framer-motion';
import { Target, TrendingDown, TrendingUp, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface GoalProgressIndicatorProps {
  currentWeight: number;
  goalWeight?: number;
  unit?: 'metric' | 'imperial';
  className?: string;
}

export function GoalProgressIndicator({
  currentWeight,
  goalWeight,
  unit = 'metric',
  className = ''
}: GoalProgressIndicatorProps) {
  if (!goalWeight) {
    return null;
  }

  const unitLabel = unit === 'metric' ? 'kg' : 'lbs';
  const difference = currentWeight - goalWeight;
  const absDifference = Math.abs(difference);
  const isAtGoal = Math.abs(difference) < 0.5; // Within 0.5 units of goal
  const isAboveGoal = difference > 0;

  // Calculate progress percentage (assuming max 50kg/110lbs difference)
  const maxDifference = unit === 'metric' ? 50 : 110;
  const progressPercent = Math.min(100, Math.max(0, ((maxDifference - absDifference) / maxDifference) * 100));

  return (
    <Card className={`bg-gradient-to-br from-purple-900/20 to-indigo-900/20 border-purple-500/30 backdrop-blur-xl overflow-hidden ${className}`}>
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
            <Target className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-gray-400">Goal Progress</h3>
            <p className="text-lg font-bold text-white">
              Target: {goalWeight} {unitLabel}
            </p>
          </div>
        </div>

        {/* Visual Progress Bar */}
        <div className="relative h-3 bg-slate-800/50 rounded-full overflow-hidden mb-4">
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
            className="mt-4 pt-4 border-t border-purple-500/20"
          >
            <p className="text-xs text-gray-400 italic text-center">
              {isAboveGoal
                ? "Keep going! Every step counts. 💪"
                : "Great progress! Consider setting a new goal. ⭐"}
            </p>
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}

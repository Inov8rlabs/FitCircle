/**
 * Daily Progress Meter Component
 *
 * Apple Fitness-inspired circular progress meter for daily goals
 * Shows progress toward completing all daily goals
 *
 * Features:
 * - Multi-ring visualization for multiple goals
 * - Real-time progress updates
 * - Celebration animations on completion
 * - Streak display
 * - Goal breakdown below rings
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { ActivityRing } from '@/components/ui/circular-progress';
import { Footprints, Scale, Smile, Zap, Flame, Check, Circle, ChevronDown, ChevronUp, Plus, PlusCircle, Dumbbell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import confetti from 'canvas-confetti';
import { GoalSetupDialog } from './GoalSetupDialog';
import type { GoalRecommendation } from '@/lib/services/goal-recommendations';

interface GoalProgress {
  goal_id: string;
  goal_type: 'steps' | 'weight_log' | 'workout' | 'mood' | 'energy' | 'custom';
  target_value: number | null;
  actual_value: number | null;
  completion_percentage: number;
  is_completed: boolean;
  unit: string | null;
}

interface DailyProgress {
  date: string;
  goals: GoalProgress[];
  overall_completion: number;
  total_goals: number;
  completed_goals: number;
}

interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  last_completion_date: string | null;
}

interface DailyProgressMeterProps {
  userId?: string;
  onGoalComplete?: () => void;
  className?: string;
}

const GOAL_COLORS: Record<string, string> = {
  steps: '#6366f1', // Indigo
  weight_log: '#8b5cf6', // Purple
  workout: '#10b981', // Green
  mood: '#f59e0b', // Amber
  energy: '#f97316', // Orange
  custom: '#06b6d4', // Cyan
};

const GOAL_ICONS: Record<string, any> = {
  steps: Footprints,
  weight_log: Scale,
  mood: Smile,
  energy: Zap,
  workout: Dumbbell,
  custom: Circle,
};

export function DailyProgressMeter({ userId, onGoalComplete, className = '' }: DailyProgressMeterProps) {
  const [progress, setProgress] = useState<DailyProgress | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const [hasShownCelebration, setHasShownCelebration] = useState(false);
  const [showGoalSetup, setShowGoalSetup] = useState(false);
  const [recommendations, setRecommendations] = useState<GoalRecommendation[]>([]);

  useEffect(() => {
    fetchProgress();
    // Refresh every 30 seconds
    const interval = setInterval(fetchProgress, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  // Fetch recommendations when there are no goals
  useEffect(() => {
    if (progress && progress.total_goals === 0) {
      fetchRecommendations();
    }
  }, [progress?.total_goals]);

  // Trigger celebration when all goals completed
  useEffect(() => {
    if (progress && progress.overall_completion === 100 && !hasShownCelebration) {
      celebrateCompletion();
      setHasShownCelebration(true);
      onGoalComplete?.();
    }
  }, [progress, hasShownCelebration, onGoalComplete]);

  const fetchProgress = async () => {
    try {
      const response = await fetch('/api/daily-goals/progress');
      if (!response.ok) throw new Error('Failed to fetch progress');

      const data = await response.json();
      setProgress(data.progress);
      setStreak(data.streak);
    } catch (error) {
      console.error('Error fetching daily progress:', error);
      // Silently fail - show empty state
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRecommendations = async () => {
    try {
      const response = await fetch('/api/daily-goals/recommendations');
      if (!response.ok) throw new Error('Failed to fetch recommendations');

      const data = await response.json();
      setRecommendations(data.recommendations || []);
    } catch (error) {
      console.error('Error fetching recommendations:', error);
      setRecommendations([]);
    }
  };

  const celebrateCompletion = () => {
    // Confetti animation
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ['#6366f1', '#8b5cf6', '#f97316', '#10b981'],
      });
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ['#6366f1', '#8b5cf6', '#f97316', '#10b981'],
      });
    }, 250);

    // Success toast
    toast.success('All daily goals complete!', {
      description: `${streak?.current_streak || 0}-day streak! Share it with your FitCircle?`,
      duration: 5000,
    });
  };

  const getGoalLabel = (type: string): string => {
    switch (type) {
      case 'steps': return 'Steps';
      case 'weight_log': return 'Weight Log';
      case 'workout': return 'Workout';
      case 'mood': return 'Mood';
      case 'energy': return 'Energy';
      default: return 'Custom';
    }
  };

  const handleCreateGoal = async (goalData: {
    goal_type: string;
    target_value: number;
    unit: string;
    frequency: string;
  }) => {
    try {
      const response = await fetch('/api/daily-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goals: [{
            ...goalData,
            start_date: new Date().toISOString().split('T')[0],
          }]
        })
      });

      if (!response.ok) throw new Error('Failed to create goal');

      toast.success(`${getGoalLabel(goalData.goal_type)} goal created!`);
      await fetchProgress();
      setShowGoalSetup(false);
    } catch (error) {
      console.error('Error creating goal:', error);
      toast.error('Failed to create goal');
    }
  };

  const handleQuickSetGoal = async (recommendation: GoalRecommendation) => {
    try {
      const response = await fetch('/api/daily-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goals: [{
            goal_type: recommendation.goal_type,
            target_value: recommendation.target_value,
            unit: recommendation.unit,
            frequency: 'daily',
            start_date: new Date().toISOString().split('T')[0],
          }]
        })
      });

      if (!response.ok) throw new Error('Failed to add goal');

      toast.success(`${getGoalLabel(recommendation.goal_type)} goal added!`);
      await fetchProgress();
    } catch (error) {
      console.error('Error adding goal:', error);
      toast.error('Failed to add goal');
    }
  };

  const formatGoalProgress = (goal: GoalProgress): string => {
    if (goal.goal_type === 'weight_log') {
      return goal.is_completed ? 'Logged' : 'Not logged';
    }
    if (goal.actual_value !== null && goal.target_value !== null) {
      return `${goal.actual_value.toLocaleString()} / ${goal.target_value.toLocaleString()} ${goal.unit || ''}`;
    }
    return 'No data';
  };

  if (isLoading) {
    return (
      <Card className={`bg-slate-900/50 border-slate-800 backdrop-blur-xl ${className}`}>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400" />
        </CardContent>
      </Card>
    );
  }

  if (!progress || progress.total_goals === 0) {
    return (
      <>
        <Card className={`bg-slate-900/50 border-slate-800 backdrop-blur-xl ${className}`}>
          <CardContent className="p-6">
            {/* Empty State Header */}
            <div className="flex flex-col items-center justify-center text-center mb-6">
              <div className="w-32 h-32 rounded-full border-4 border-dashed border-slate-700 flex items-center justify-center mb-4">
                <p className="text-sm text-gray-400">No Goals</p>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Set Your Daily Goals</h3>
              <p className="text-sm text-gray-400 mb-4">
                Create personal goals or join a FitCircle for team challenges
              </p>

              {/* Create Goals Button */}
              <Button
                onClick={() => setShowGoalSetup(true)}
                className="bg-indigo-600 hover:bg-indigo-700"
                leftIcon={<Plus className="h-4 w-4" />}
              >
                Create Daily Goals
              </Button>
            </div>

            {/* Smart Recommendations */}
            {recommendations.length > 0 && (
              <div className="mt-6 pt-6 border-t border-slate-800">
                <h4 className="text-sm font-medium text-gray-300 mb-3">
                  Recommended for you
                </h4>
                <div className="space-y-2">
                  {recommendations.slice(0, 3).map((rec, idx) => {
                    const Icon = GOAL_ICONS[rec.goal_type] || Circle;
                    const color = GOAL_COLORS[rec.goal_type] || GOAL_COLORS.custom;

                    return (
                      <button
                        key={idx}
                        onClick={() => handleQuickSetGoal(rec)}
                        className="w-full text-left p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-all group"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                            style={{
                              backgroundColor: `${color}20`,
                            }}
                          >
                            <Icon className="h-5 w-5" style={{ color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-medium text-white">
                                {getGoalLabel(rec.goal_type)} - {rec.target_value.toLocaleString()} {rec.unit}
                              </p>
                              {rec.priority === 'high' && (
                                <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-500/20 text-orange-400">
                                  Recommended
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              {rec.reason}
                            </p>
                            {rec.challenge_name && (
                              <p className="text-xs text-indigo-400 mt-1">
                                For: {rec.challenge_name}
                              </p>
                            )}
                          </div>
                          <PlusCircle className="flex-shrink-0 w-5 h-5 text-gray-400 group-hover:text-indigo-400 transition-colors" />
                        </div>
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-gray-500 mt-4 text-center">
                  Tap a recommendation to add it as your daily goal
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Goal Setup Dialog */}
        <GoalSetupDialog
          open={showGoalSetup}
          onClose={() => setShowGoalSetup(false)}
          onSave={handleCreateGoal}
        />
      </>
    );
  }

  // Build rings for visualization
  const rings = progress.goals.map((goal) => ({
    value: goal.actual_value || 0,
    max: goal.target_value || 100,
    color: GOAL_COLORS[goal.goal_type] || GOAL_COLORS.custom,
    label: getGoalLabel(goal.goal_type),
  }));

  return (
    <Card className={`bg-slate-900/50 border-slate-800 backdrop-blur-xl ${className}`}>
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Daily Goals</h3>
            <p className="text-sm text-gray-400">
              {progress.completed_goals} of {progress.total_goals} complete
            </p>
          </div>
          {streak && streak.current_streak > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 border border-orange-500/20 rounded-full">
              <Flame className="h-4 w-4 text-orange-400" />
              <span className="text-sm font-semibold text-orange-400">
                {streak.current_streak} day{streak.current_streak !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Main Ring Visualization */}
        <div className="flex flex-col items-center justify-center py-6">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <ActivityRing
              rings={rings}
              size={200}
              strokeWidth={14}
              className="mb-4"
            />
          </motion.div>

          {/* Overall Completion */}
          <div className="text-center">
            <motion.div
              key={progress.overall_completion}
              initial={{ scale: 1.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-4xl font-bold text-white mb-1"
            >
              {Math.round(progress.overall_completion)}%
            </motion.div>
            <p className="text-sm text-gray-400">
              {progress.overall_completion === 100 ? 'All goals complete!' : 'Daily Progress'}
            </p>
          </div>
        </div>

        {/* Goal Breakdown */}
        <div className="space-y-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center justify-between text-sm text-gray-400 hover:text-white transition-colors"
          >
            <span>Goal Details</span>
            {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-2 overflow-hidden"
              >
                {progress.goals.map((goal) => {
                  const Icon = GOAL_ICONS[goal.goal_type] || Circle;
                  const color = GOAL_COLORS[goal.goal_type] || GOAL_COLORS.custom;

                  return (
                    <div
                      key={goal.goal_id}
                      className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg"
                    >
                      {goal.is_completed ? (
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                          <Check className="h-4 w-4 text-green-400" />
                        </div>
                      ) : (
                        <div
                          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: `${color}20` }}
                        >
                          <Icon className="h-4 w-4" style={{ color }} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-sm font-medium text-white truncate">
                            {getGoalLabel(goal.goal_type)}
                          </p>
                          <span className="text-xs font-semibold text-gray-400">
                            {Math.round(goal.completion_percentage)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${goal.completion_percentage}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: color }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {formatGoalProgress(goal)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* All Goals Complete Message */}
        <AnimatePresence>
          {progress.overall_completion === 100 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-center"
            >
              <p className="text-sm font-semibold text-green-400 mb-1">
                All goals complete! 🎉
              </p>
              <p className="text-xs text-gray-400">
                You're on track for your FitCircle challenge
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Footprints, Save, X, Loader2, Edit2, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircularProgress } from '@/components/ui/circular-progress';

interface StepsGoalCardProps {
  currentSteps: number;
  dailyGoal: number;
  onGoalSaved?: () => void;
  className?: string;
}

export function StepsGoalCard({
  currentSteps,
  dailyGoal,
  onGoalSaved,
  className = ''
}: StepsGoalCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [goalInput, setGoalInput] = useState(dailyGoal.toString());
  const [isSaving, setIsSaving] = useState(false);

  const percentage = Math.min(100, Math.round((currentSteps / dailyGoal) * 100));
  const isGoalMet = currentSteps >= dailyGoal;

  const handleSaveGoal = async () => {
    if (!goalInput) return;

    setIsSaving(true);
    try {
      const { supabase } = await import('@/lib/supabase');
      const { useAuthStore } = await import('@/stores/auth-store');

      const user = useAuthStore.getState().user;
      if (!user) throw new Error('No user found');

      const newGoal = parseInt(goalInput);

      // Get current goals
      const { data: profileData, error: fetchError } = (await supabase
        .from('profiles')
        .select('goals')
        .eq('id', user.id)
        .single()) as { data: any; error: any };

      if (fetchError) throw fetchError;

      const currentGoals = profileData?.goals || [];
      const otherGoals = Array.isArray(currentGoals)
        ? currentGoals.filter((g: any) => g.type !== 'steps')
        : [];

      const updatedGoals = [
        ...otherGoals,
        {
          type: 'steps',
          daily_steps_target: newGoal,
          created_at: new Date().toISOString()
        }
      ];

      const { error: updateError } = await (supabase
        .from('profiles') as any)
        .update({ goals: updatedGoals })
        .eq('id', user.id);

      if (updateError) throw updateError;

      const { toast } = await import('sonner');
      toast.success('Steps goal updated successfully!');
      setIsEditing(false);

      // Trigger refresh
      if (onGoalSaved) onGoalSaved();
    } catch (error) {
      console.error('Error saving steps goal:', error);
      const { toast } = await import('sonner');
      toast.error('Failed to save steps goal');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className={`bg-slate-900/50 border-slate-800 backdrop-blur-xl h-full ${className}`}>
      <CardContent className="p-3 flex flex-col items-center justify-center h-full">
        <AnimatePresence mode="wait">
          {!isEditing ? (
            <motion.div
              key="display"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center w-full"
            >
              <CircularProgress
                value={currentSteps}
                max={dailyGoal}
                size={80}
                strokeWidth={8}
                color="#6366f1"
                icon={Footprints}
                showValue={false}
              />
              <div className="mt-2 text-center">
                <p className="text-xs text-gray-400">Steps</p>
                <p className="text-sm font-bold text-white">{currentSteps.toLocaleString()}</p>
                <div className="flex items-center justify-center gap-2 mt-1">
                  <p className="text-xs text-gray-500">Goal: {dailyGoal.toLocaleString()}</p>
                  <button
                    onClick={() => {
                      setIsEditing(true);
                      setGoalInput(dailyGoal.toString());
                    }}
                    className="text-gray-500 hover:text-indigo-400 transition-colors"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {isGoalMet && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="mt-2 flex items-center gap-1 text-xs text-green-400"
                >
                  <TrendingUp className="w-3 h-3" />
                  Goal reached! 🎉
                </motion.div>
              )}
              {!isGoalMet && percentage > 0 && (
                <p className="text-xs text-indigo-400 mt-1">{percentage}% of goal</p>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-3 w-full"
            >
              <div>
                <Label htmlFor="stepsGoalInput" className="text-xs font-medium text-gray-300 mb-2 block">
                  Daily Steps Goal
                </Label>
                <Input
                  id="stepsGoalInput"
                  type="number"
                  step="100"
                  placeholder="e.g., 10000"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500 text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveGoal}
                  disabled={isSaving || !goalInput}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-8 text-xs"
                  size="sm"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-3 h-3 mr-1" />
                      Save
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => {
                    setIsEditing(false);
                    setGoalInput(dailyGoal.toString());
                  }}
                  variant="outline"
                  size="sm"
                  className="bg-slate-800/50 border-slate-700 text-gray-300 hover:bg-slate-800 h-8"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QuickEntryCard } from '@/components/QuickEntryCard';
import { BathroomScale } from '@/components/icons/BathroomScale';
import { Footprints, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { parseWeightToKg, getWeightUnit } from '@/lib/utils/units';

interface SubmitProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  challengeId: string;
  challengeName: string;
  challengeType: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
  userId: string;
  unitSystem: 'metric' | 'imperial';
  onSubmitSuccess?: () => void;
}

export function SubmitProgressDialog({
  open,
  onOpenChange,
  challengeId,
  challengeName,
  challengeType,
  userId,
  unitSystem,
  onSubmitSuccess,
}: SubmitProgressDialogProps) {
  const [quickWeight, setQuickWeight] = useState('');
  const [quickSteps, setQuickSteps] = useState('');

  // Quick entry for weight
  const handleQuickWeightSubmit = async () => {
    if (!userId || !quickWeight) return;

    const today = new Date().toISOString().split('T')[0];
    const weightInKg = parseWeightToKg(quickWeight, unitSystem);

    const { error } = await supabase
      .from('daily_tracking')
      .upsert({
        user_id: userId,
        tracking_date: today,
        weight_kg: weightInKg,
      } as any, {
        onConflict: 'user_id,tracking_date'
      });

    if (error) throw error;

    toast.success('Weight logged!');
    setQuickWeight('');

    if (onSubmitSuccess) {
      onSubmitSuccess();
    }
  };

  // Quick entry for steps
  const handleQuickStepsSubmit = async () => {
    if (!userId || !quickSteps) return;

    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase
      .from('daily_tracking')
      .upsert({
        user_id: userId,
        tracking_date: today,
        steps: parseInt(quickSteps),
      } as any, {
        onConflict: 'user_id,tracking_date'
      });

    if (error) throw error;

    toast.success('Steps logged!');
    setQuickSteps('');

    if (onSubmitSuccess) {
      onSubmitSuccess();
    }
  };

  // Determine which input to show based on challenge type
  const showWeight = challengeType === 'weight_loss' || challengeType === 'custom';
  const showSteps = challengeType === 'step_count' || challengeType === 'custom';

  // Count how many cards to show
  const cardCount = (showWeight ? 1 : 0) + (showSteps ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-xl max-w-3xl">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="h-6 w-6 text-green-400" />
            </div>
            Submit Progress
          </DialogTitle>
          <DialogDescription className="text-gray-400 text-base pt-1">
            Log your progress for <span className="text-white font-semibold">{challengeName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="py-6">
          {/* Cards Container - centered if single card */}
          <div
            className={`grid gap-6 ${
              cardCount === 1
                ? 'grid-cols-1 max-w-md mx-auto'
                : 'grid-cols-1 sm:grid-cols-2'
            }`}
          >
            {showWeight && (
              <QuickEntryCard
                icon={BathroomScale}
                label="Weight"
                value={quickWeight}
                onChange={setQuickWeight}
                onSubmit={handleQuickWeightSubmit}
                placeholder={unitSystem === 'metric' ? '70.0' : '154.0'}
                unit={getWeightUnit(unitSystem)}
                color="purple-500"
                type="number"
                step="0.1"
                min="0"
                helperText={`Today's weight in ${getWeightUnit(unitSystem)}`}
              />
            )}

            {showSteps && (
              <QuickEntryCard
                icon={Footprints as any}
                label="Steps"
                value={quickSteps}
                onChange={setQuickSteps}
                onSubmit={handleQuickStepsSubmit}
                placeholder="10000"
                unit="steps"
                color="indigo-500"
                type="number"
                step="1"
                min="0"
                helperText="Today's step count"
              />
            )}
          </div>

          {/* Info Box */}
          <div className="mt-8 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <div className="p-1.5 bg-green-500/20 rounded-lg">
                  <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-300 leading-relaxed">
                  <span className="font-semibold">Tip:</span> Your progress will be logged for today and will automatically update the leaderboard for this challenge.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

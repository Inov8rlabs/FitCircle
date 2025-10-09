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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-xl max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-green-400" />
            Submit Progress
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Log your progress for <span className="text-white font-semibold">{challengeName}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="mt-6 bg-green-500/10 border border-green-500/20 rounded-lg p-4">
            <p className="text-sm text-green-300">
              💡 <strong>Tip:</strong> Your progress will be logged for today and will automatically update
              the leaderboard for this challenge.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

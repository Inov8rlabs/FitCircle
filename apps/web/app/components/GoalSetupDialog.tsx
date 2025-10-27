/**
 * Goal Setup Dialog Component
 *
 * Modal for creating personal daily goals
 * - Supports multiple goal types (steps, weight log, workouts, custom)
 * - Configurable targets and frequency
 * - Used when user wants to set goals without joining a FitCircle
 */

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Footprints, Scale, Dumbbell, Star } from 'lucide-react';

interface GoalData {
  goal_type: string;
  target_value: number;
  unit: string;
  frequency: string;
}

interface GoalSetupDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (goal: GoalData) => Promise<void>;
}

const GOAL_TYPES = [
  {
    value: 'steps',
    label: 'Steps',
    icon: Footprints,
    defaultTarget: 10000,
    unit: 'steps',
    description: 'Daily step count goal',
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10',
    borderColor: 'border-indigo-500',
  },
  {
    value: 'weight_log',
    label: 'Weight Tracking',
    icon: Scale,
    defaultTarget: 1,
    unit: 'times',
    description: 'Log your weight daily',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500',
  },
  {
    value: 'workout',
    label: 'Workouts',
    icon: Dumbbell,
    defaultTarget: 1,
    unit: 'sessions',
    description: 'Complete workout sessions',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500',
  },
  {
    value: 'custom',
    label: 'Custom Goal',
    icon: Star,
    defaultTarget: 1,
    unit: 'units',
    description: 'Create your own goal',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500',
  },
];

export function GoalSetupDialog({ open, onClose, onSave }: GoalSetupDialogProps) {
  const [goalType, setGoalType] = useState<string>('steps');
  const [targetValue, setTargetValue] = useState<number>(10000);
  const [frequency, setFrequency] = useState<string>('daily');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedGoalType = GOAL_TYPES.find(t => t.value === goalType);

  const handleGoalTypeChange = (type: string) => {
    setGoalType(type);
    const goalTypeConfig = GOAL_TYPES.find(t => t.value === type);
    if (goalTypeConfig) {
      setTargetValue(goalTypeConfig.defaultTarget);
    }
  };

  const handleSave = async () => {
    if (!selectedGoalType) return;

    setIsSubmitting(true);
    try {
      await onSave({
        goal_type: goalType,
        target_value: targetValue,
        unit: selectedGoalType.unit,
        frequency,
      });
      onClose();
    } catch (error) {
      console.error('Error saving goal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white">Create Daily Goal</DialogTitle>
          <DialogDescription className="text-gray-400">
            Set a personal daily goal to track your progress
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Goal Type Selector */}
          <div>
            <Label className="text-white mb-3 block">Goal Type</Label>
            <div className="grid grid-cols-2 gap-3">
              {GOAL_TYPES.map(type => {
                const Icon = type.icon;
                const isSelected = goalType === type.value;

                return (
                  <button
                    key={type.value}
                    onClick={() => handleGoalTypeChange(type.value)}
                    className={`
                      p-4 rounded-lg border-2 transition-all
                      ${isSelected
                        ? `${type.borderColor} ${type.bgColor}`
                        : 'border-slate-700 hover:border-slate-600'
                      }
                    `}
                  >
                    <div className={`${type.color} mb-2`}>
                      <Icon className="h-6 w-6 mx-auto" />
                    </div>
                    <div className="text-sm font-medium text-white mb-1">
                      {type.label}
                    </div>
                    <div className="text-xs text-gray-400">
                      {type.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Target Value */}
          <div>
            <Label htmlFor="target-value" className="text-white mb-2 block">
              Daily Target
            </Label>
            <div className="relative">
              <Input
                id="target-value"
                type="number"
                min="1"
                value={targetValue}
                onChange={(e) => setTargetValue(parseInt(e.target.value) || 1)}
                className="bg-slate-800 border-slate-700 text-white pr-20"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                {selectedGoalType?.unit}
              </div>
            </div>
            {goalType === 'steps' && (
              <p className="text-xs text-gray-500 mt-2">
                Recommended: 8,000-10,000 steps per day
              </p>
            )}
          </div>

          {/* Frequency */}
          <div>
            <Label htmlFor="frequency" className="text-white mb-2 block">
              Frequency
            </Label>
            <select
              id="frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full h-10 px-3 rounded-md bg-slate-800 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              <option value="daily">Every Day</option>
              <option value="weekdays">Weekdays Only</option>
              <option value="weekends">Weekends Only</option>
            </select>
            <p className="text-xs text-gray-500 mt-2">
              When this goal should apply
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 border-slate-700 hover:bg-slate-800"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSubmitting || !targetValue || targetValue < 1}
              loading={isSubmitting}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            >
              Create Goal
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

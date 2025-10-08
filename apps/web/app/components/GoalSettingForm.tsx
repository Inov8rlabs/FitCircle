'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Trophy,
  Target,
  Footprints,
  Dumbbell,
  Star,
  ChevronLeft,
  ChevronRight,
  Lock,
  Eye,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Scale,
  Activity,
  TrendingDown,
} from 'lucide-react';
import { toast } from 'sonner';

interface GoalSettingFormProps {
  circleName: string;
  challengeType: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
  duration: number;
  onSubmit: (goalData: any) => void;
  onBack?: () => void;
  isSubmitting?: boolean;
}

type GoalUnit = 'lbs' | 'kg' | 'steps' | 'workouts' | 'custom';

interface GoalData {
  type: string;
  current_value: number;
  target_value: number;
  unit: GoalUnit;
  description?: string;
}

export default function GoalSettingForm({
  circleName,
  challengeType,
  duration,
  onSubmit,
  onBack,
  isSubmitting = false,
}: GoalSettingFormProps) {
  const [goalData, setGoalData] = useState<GoalData>({
    type: challengeType,
    current_value: 0,
    target_value: 0,
    unit: challengeType === 'weight_loss' ? 'lbs' : challengeType === 'step_count' ? 'steps' : 'workouts',
    description: '',
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validateGoal = () => {
    const newErrors: { [key: string]: string } = {};

    if (goalData.current_value <= 0) {
      newErrors.current_value = 'Please enter your current value';
    }

    if (goalData.target_value <= 0) {
      newErrors.target_value = 'Please enter your target value';
    }

    if (challengeType === 'weight_loss') {
      if (goalData.target_value >= goalData.current_value) {
        newErrors.target_value = 'Target weight should be less than current weight';
      }

      const totalLoss = goalData.current_value - goalData.target_value;
      const weeksInChallenge = duration / 7;
      const weeklyLoss = totalLoss / weeksInChallenge;

      if (weeklyLoss > 2) {
        newErrors.target_value = 'For healthy weight loss, aim for maximum 2 lbs per week';
      }
    }

    if (challengeType === 'step_count') {
      if (goalData.target_value > 50000) {
        newErrors.target_value = 'Daily step goal should not exceed 50,000 steps';
      }
    }

    if (challengeType === 'workout_frequency') {
      if (goalData.target_value > 14) {
        newErrors.target_value = 'Maximum 14 workouts per week (2 per day)';
      }
    }

    if (challengeType === 'custom' && !goalData.description) {
      newErrors.description = 'Please describe your custom goal';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (validateGoal()) {
      const progressGoal = calculateProgressPreview();
      onSubmit({
        ...goalData,
        progress_preview: progressGoal,
      });
    } else {
      toast.error('Please fix the errors before continuing');
    }
  };

  const calculateProgressPreview = () => {
    if (challengeType === 'weight_loss') {
      const toLose = goalData.current_value - goalData.target_value;
      return `Lose ${toLose.toFixed(1)} ${goalData.unit}`;
    } else if (challengeType === 'step_count') {
      const totalSteps = goalData.target_value * duration;
      return `${goalData.target_value.toLocaleString()} steps/day for ${duration} days`;
    } else if (challengeType === 'workout_frequency') {
      const totalWorkouts = goalData.target_value * (duration / 7);
      return `${Math.round(totalWorkouts)} workouts over ${duration} days`;
    } else {
      return goalData.description || 'Custom goal';
    }
  };

  const getGoalIcon = () => {
    switch (challengeType) {
      case 'weight_loss':
        return Scale;
      case 'step_count':
        return Footprints;
      case 'workout_frequency':
        return Dumbbell;
      default:
        return Star;
    }
  };

  const getGoalColor = () => {
    switch (challengeType) {
      case 'weight_loss':
        return 'from-purple-500 to-purple-600';
      case 'step_count':
        return 'from-indigo-500 to-indigo-600';
      case 'workout_frequency':
        return 'from-orange-500 to-orange-600';
      default:
        return 'from-green-500 to-green-600';
    }
  };

  const GoalIcon = getGoalIcon();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative max-w-2xl w-full"
      >
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
          <CardHeader>
            <div className="flex items-center justify-between mb-4">
              {onBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onBack}
                  className="text-gray-400 hover:text-white"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              )}
              <Badge variant="secondary" className="bg-slate-800">
                Joining: {circleName}
              </Badge>
            </div>

            <CardTitle className="text-2xl font-bold">
              <span className="bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
                Set Your Personal Goal
              </span>
            </CardTitle>
            <CardDescription className="text-base text-gray-400 mt-2">
              Define what success looks like for you in this {duration}-day challenge
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Goal Type Display */}
            <div className={`p-4 rounded-lg bg-gradient-to-r ${getGoalColor()} bg-opacity-10`}>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/10 rounded-lg">
                  <GoalIcon className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-white font-semibold">
                    {challengeType === 'weight_loss' && 'Weight Loss Challenge'}
                    {challengeType === 'step_count' && 'Daily Steps Challenge'}
                    {challengeType === 'workout_frequency' && 'Workout Frequency Challenge'}
                    {challengeType === 'custom' && 'Custom Goal Challenge'}
                  </p>
                  <p className="text-xs text-gray-200 mt-1">
                    Track your progress over {duration} days
                  </p>
                </div>
              </div>
            </div>

            {/* Weight Loss Fields */}
            {challengeType === 'weight_loss' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="current_weight" className="text-white">
                      Current Weight
                    </Label>
                    <div className="relative">
                      <Input
                        id="current_weight"
                        type="number"
                        step="0.01"
                        value={goalData.current_value || ''}
                        onChange={(e) => setGoalData({
                          ...goalData,
                          current_value: parseFloat(e.target.value) || 0,
                        })}
                        className={`pr-12 bg-slate-800/50 border-slate-700 text-white ${
                          errors.current_value ? 'border-red-500' : ''
                        }`}
                        placeholder="180"
                      />
                      <div className="absolute right-2 top-3 text-gray-400">
                        <Select
                          value={goalData.unit}
                          onValueChange={(value: GoalUnit) => setGoalData({ ...goalData, unit: value })}
                        >
                          <SelectTrigger className="border-0 bg-transparent h-auto p-0 text-sm w-16 gap-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="lbs">lbs</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {errors.current_value && (
                      <p className="text-xs text-red-400">{errors.current_value}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="target_weight" className="text-white">
                      Target Weight
                    </Label>
                    <div className="relative">
                      <Input
                        id="target_weight"
                        type="number"
                        step="0.01"
                        value={goalData.target_value || ''}
                        onChange={(e) => setGoalData({
                          ...goalData,
                          target_value: parseFloat(e.target.value) || 0,
                        })}
                        className={`pr-12 bg-slate-800/50 border-slate-700 text-white ${
                          errors.target_value ? 'border-red-500' : ''
                        }`}
                        placeholder="160"
                      />
                      <div className="absolute right-3 top-3 text-gray-400 text-sm">
                        {goalData.unit}
                      </div>
                    </div>
                    {errors.target_value && (
                      <p className="text-xs text-red-400">{errors.target_value}</p>
                    )}
                  </div>
                </div>

                {goalData.current_value > 0 && goalData.target_value > 0 && goalData.target_value < goalData.current_value && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-purple-900/20 to-purple-800/10 rounded-lg p-4 border border-purple-500/30"
                  >
                    <div className="flex items-center gap-3">
                      <TrendingDown className="h-5 w-5 text-purple-400" />
                      <div>
                        <p className="text-white font-medium">
                          Goal: Lose {(goalData.current_value - goalData.target_value).toFixed(1)} {goalData.unit}
                        </p>
                        <p className="text-xs text-gray-400">
                          That's {((goalData.current_value - goalData.target_value) / (duration / 7)).toFixed(1)} {goalData.unit} per week
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Step Count Fields */}
            {challengeType === 'step_count' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="current_steps" className="text-white">
                      Current Daily Average
                    </Label>
                    <div className="relative">
                      <Input
                        id="current_steps"
                        type="number"
                        value={goalData.current_value || ''}
                        onChange={(e) => setGoalData({
                          ...goalData,
                          current_value: parseInt(e.target.value) || 0,
                        })}
                        className="pr-16 bg-slate-800/50 border-slate-700 text-white"
                        placeholder="5000"
                      />
                      <div className="absolute right-3 top-3 text-gray-400 text-sm">
                        steps
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="target_steps" className="text-white">
                      Daily Step Goal
                    </Label>
                    <div className="relative">
                      <Input
                        id="target_steps"
                        type="number"
                        value={goalData.target_value || ''}
                        onChange={(e) => setGoalData({
                          ...goalData,
                          target_value: parseInt(e.target.value) || 0,
                        })}
                        className={`pr-16 bg-slate-800/50 border-slate-700 text-white ${
                          errors.target_value ? 'border-red-500' : ''
                        }`}
                        placeholder="10000"
                      />
                      <div className="absolute right-3 top-3 text-gray-400 text-sm">
                        steps
                      </div>
                    </div>
                    {errors.target_value && (
                      <p className="text-xs text-red-400">{errors.target_value}</p>
                    )}
                  </div>
                </div>

                {goalData.target_value > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-indigo-900/20 to-indigo-800/10 rounded-lg p-4 border border-indigo-500/30"
                  >
                    <div className="flex items-center gap-3">
                      <Activity className="h-5 w-5 text-indigo-400" />
                      <div>
                        <p className="text-white font-medium">
                          Goal: {goalData.target_value.toLocaleString()} steps/day
                        </p>
                        <p className="text-xs text-gray-400">
                          Total: {(goalData.target_value * duration).toLocaleString()} steps over {duration} days
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Workout Frequency Fields */}
            {challengeType === 'workout_frequency' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="current_workouts" className="text-white">
                      Current Workouts/Week
                    </Label>
                    <Input
                      id="current_workouts"
                      type="number"
                      value={goalData.current_value || ''}
                      onChange={(e) => setGoalData({
                        ...goalData,
                        current_value: parseInt(e.target.value) || 0,
                      })}
                      className="bg-slate-800/50 border-slate-700 text-white"
                      placeholder="2"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="target_workouts" className="text-white">
                      Target Workouts/Week
                    </Label>
                    <Input
                      id="target_workouts"
                      type="number"
                      value={goalData.target_value || ''}
                      onChange={(e) => setGoalData({
                        ...goalData,
                        target_value: parseInt(e.target.value) || 0,
                      })}
                      className={`bg-slate-800/50 border-slate-700 text-white ${
                        errors.target_value ? 'border-red-500' : ''
                      }`}
                      placeholder="5"
                    />
                    {errors.target_value && (
                      <p className="text-xs text-red-400">{errors.target_value}</p>
                    )}
                  </div>
                </div>

                {goalData.target_value > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-orange-900/20 to-orange-800/10 rounded-lg p-4 border border-orange-500/30"
                  >
                    <div className="flex items-center gap-3">
                      <Dumbbell className="h-5 w-5 text-orange-400" />
                      <div>
                        <p className="text-white font-medium">
                          Goal: {goalData.target_value} workouts per week
                        </p>
                        <p className="text-xs text-gray-400">
                          Total: {Math.round(goalData.target_value * (duration / 7))} workouts over {duration} days
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {/* Custom Goal Fields */}
            {challengeType === 'custom' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="goal_description" className="text-white">
                    Describe Your Goal
                  </Label>
                  <Textarea
                    id="goal_description"
                    value={goalData.description}
                    onChange={(e) => setGoalData({ ...goalData, description: e.target.value })}
                    className={`bg-slate-800/50 border-slate-700 text-white min-h-[80px] ${
                      errors.description ? 'border-red-500' : ''
                    }`}
                    placeholder="e.g., Complete a 5K run, Do 100 pushups, Meditate for 30 days..."
                    maxLength={200}
                  />
                  {errors.description && (
                    <p className="text-xs text-red-400">{errors.description}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    {goalData.description?.length || 0}/200 characters
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="custom_start" className="text-white">
                      Starting Value <span className="text-gray-500">(optional)</span>
                    </Label>
                    <Input
                      id="custom_start"
                      type="number"
                      value={goalData.current_value || ''}
                      onChange={(e) => setGoalData({
                        ...goalData,
                        current_value: parseFloat(e.target.value) || 0,
                      })}
                      className="bg-slate-800/50 border-slate-700 text-white"
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom_target" className="text-white">
                      Target Value
                    </Label>
                    <Input
                      id="custom_target"
                      type="number"
                      value={goalData.target_value || ''}
                      onChange={(e) => setGoalData({
                        ...goalData,
                        target_value: parseFloat(e.target.value) || 0,
                      })}
                      className="bg-slate-800/50 border-slate-700 text-white"
                      placeholder="100"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Privacy Reminder */}
            <div className="bg-gradient-to-br from-green-900/20 to-green-800/10 rounded-lg p-4 border border-green-500/30">
              <div className="flex items-start gap-3">
                <div className="p-1 bg-green-500/20 rounded-lg">
                  <Lock className="h-4 w-4 text-green-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-400 mb-1">
                    Your Privacy is Protected
                  </p>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <Eye className="h-3 w-3 text-gray-400" />
                      <span>Others will only see: "You're at 65% of your goal"</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <Lock className="h-3 w-3 text-gray-400" />
                      <span>Never shared: Your actual weight, steps, or specific numbers</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 py-6 text-lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Joining Circle...
                </>
              ) : (
                <>
                  Join FitCircle
                  <ChevronRight className="h-5 w-5 ml-2" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
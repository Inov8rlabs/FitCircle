'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CircularProgress, ActivityRing, CircularSlider } from '@/components/ui/circular-progress';
import { UnitToggle } from '@/components/ui/unit-toggle';
import { BathroomScale } from '@/components/icons/BathroomScale';
import {
  Scale,
  Footprints,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Calendar,
  Trophy,
  Flame,
  Plus,
  Check,
  Loader2,
  Sparkles,
  Smile,
  Zap
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import DashboardNav from '@/components/DashboardNav';
import { GoalProgressIndicator } from '@/components/GoalProgressIndicator';
import { StepsGoalCard } from '@/components/StepsGoalCard';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import {
  formatWeight,
  parseWeightToKg,
  weightKgToDisplay,
  getWeightUnit,
  getWeightPlaceholder,
} from '@/lib/utils/units';

interface CheckIn {
  id: string;
  tracking_date: string;
  weight_kg?: number;
  steps?: number;
  mood_score?: number;
  energy_level?: number;
  notes?: string;
  created_at: string;
}

interface DailyStats {
  todaySteps: number;
  todayWeight?: number;
  weeklyAvgSteps: number;
  weightChange: number;
  currentStreak: number;
  totalCheckIns: number;
}

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { unitSystem, setUnitSystem, isLoading: isLoadingUnits } = useUnitPreference();
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [isLoadingCheckIns, setIsLoadingCheckIns] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [goalWeightKg, setGoalWeightKg] = useState<number | undefined>();
  const [startingWeightKg, setStartingWeightKg] = useState<number | undefined>();
  const [dailyStepsGoal, setDailyStepsGoal] = useState<number>(10000); // Default 10k steps
  const [dailyStats, setDailyStats] = useState<DailyStats>({
    todaySteps: 0,
    todayWeight: undefined,
    weeklyAvgSteps: 0,
    weightChange: 0,
    currentStreak: 0,
    totalCheckIns: 0,
  });

  const [checkInForm, setCheckInForm] = useState({
    weight: '',
    steps: '',
    mood: 3,
    energy: 3,
    notes: '',
  });

  // Fetch check-ins and profile on mount
  useEffect(() => {
    if (user) {
      fetchCheckIns();
      fetchDailyStats();
      fetchGoalWeight();
    }
  }, [user]);

  const fetchGoalWeight = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('goals')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      // Extract goals from goals array
      const profileData = data as any;
      if (profileData?.goals && Array.isArray(profileData.goals)) {
        const goals = profileData.goals;
        const weightGoal = goals.find((goal: any) => goal.type === 'weight');
        if (weightGoal?.target_weight_kg) {
          setGoalWeightKg(weightGoal.target_weight_kg);
          setStartingWeightKg(weightGoal.starting_weight_kg);
        }

        const stepsGoal = goals.find((goal: any) => goal.type === 'steps');
        if (stepsGoal?.daily_steps_target) {
          setDailyStepsGoal(stepsGoal.daily_steps_target);
        }
      }
    } catch (error) {
      console.error('Error fetching goals:', error);
    }
  };

  const fetchCheckIns = async () => {
    if (!user) return;

    setIsLoadingCheckIns(true);
    try {
      const { data, error } = await supabase
        .from('daily_tracking')
        .select('*')
        .eq('user_id', user.id)
        .order('tracking_date', { ascending: false })
        .limit(30);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      setCheckIns(data || []);
    } catch (error: any) {
      console.error('Error fetching check-ins:', error);
      if (error.code !== 'PGRST116' && error.code !== '42P01') {
        toast.error('Failed to load check-ins');
      }
    } finally {
      setIsLoadingCheckIns(false);
    }
  };

  const fetchDailyStats = async () => {
    if (!user) return;

    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data: todayData } = await supabase
        .from('daily_tracking')
        .select('weight_kg, steps')
        .eq('user_id', user.id)
        .eq('tracking_date', today)
        .maybeSingle() as { data: any };

      const { data: weekData } = await supabase
        .from('daily_tracking')
        .select('steps, weight_kg, tracking_date')
        .eq('user_id', user.id)
        .gte('tracking_date', weekAgo)
        .order('tracking_date', { ascending: false });

      const weekDataTyped = weekData as any[] || [];
      const weeklySteps = weekDataTyped.map(d => d.steps || 0).filter(s => s > 0);
      const weeklyAvgSteps = weeklySteps.length > 0
        ? Math.round(weeklySteps.reduce((a, b) => a + b, 0) / weeklySteps.length)
        : 0;

      let weightChange = 0;
      if (weekDataTyped.length > 1) {
        const weights = weekDataTyped.map(d => d.weight_kg).filter(w => w);
        if (weights.length > 1) {
          // Calculate change in kg first
          const changeInKg = Math.round((weights[0]! - weights[weights.length - 1]!) * 10) / 10;
          // Store raw kg value (will be converted for display later if needed)
          weightChange = changeInKg;
        }
      }

      let streak = 0;
      if (weekDataTyped.length > 0) {
        const dates = weekDataTyped.map(d => d.tracking_date);
        const todayDate = new Date();

        for (let i = 0; i < 30; i++) {
          const checkDate = new Date(todayDate);
          checkDate.setDate(checkDate.getDate() - i);
          const checkDateStr = checkDate.toISOString().split('T')[0];

          if (dates.includes(checkDateStr)) {
            streak++;
          } else if (i > 0) {
            break;
          }
        }
      }

      const { count } = await supabase
        .from('daily_tracking')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      setDailyStats({
        todaySteps: todayData?.steps || 0,
        todayWeight: todayData?.weight_kg,
        weeklyAvgSteps,
        weightChange,
        currentStreak: streak,
        totalCheckIns: count || 0,
      });
    } catch (error) {
      console.error('Error fetching daily stats:', error);
    }
  };

  const handleCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error('Please log in to check in');
      return;
    }

    setIsSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];

      // Convert weight to kg if in imperial units
      const weightInKg = checkInForm.weight
        ? parseWeightToKg(checkInForm.weight, unitSystem)
        : null;

      const checkInData = {
        user_id: user.id,
        tracking_date: today,
        weight_kg: weightInKg,
        steps: checkInForm.steps ? parseInt(checkInForm.steps) : null,
        mood_score: checkInForm.mood <= 5 ? checkInForm.mood * 2 : checkInForm.mood, // Convert 1-5 to 2-10 for DB
        energy_level: checkInForm.energy <= 5 ? checkInForm.energy * 2 : checkInForm.energy, // Convert 1-5 to 2-10 for DB
        notes: checkInForm.notes || null,
      };

      const { error } = await supabase
        .from('daily_tracking')
        .upsert(checkInData as any, {
          onConflict: 'user_id,tracking_date'
        });

      if (error) throw error;

      toast.success('Check-in saved successfully!');

      setCheckInForm({
        weight: '',
        steps: '',
        mood: 3,
        energy: 3,
        notes: '',
      });

      fetchCheckIns();
      fetchDailyStats();
    } catch (error: any) {
      console.error('Check-in error:', error);
      toast.error(error.message || 'Failed to save check-in');
    } finally {
      setIsSubmitting(false);
    }
  };

  const chartData = checkIns
    .slice(0, 14)
    .reverse()
    .map(checkIn => ({
      date: new Date(checkIn.tracking_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      weight: checkIn.weight_kg ? weightKgToDisplay(checkIn.weight_kg, unitSystem) : null,
      weightRaw: checkIn.weight_kg || null, // Keep raw kg for calculations if needed
      steps: checkIn.steps || 0,
      mood: checkIn.mood_score || 0,
      energy: checkIn.energy_level || 0,
    }));

  return (
    <>
      <DashboardNav />
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Subtle circle background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 sm:mb-12"
        >
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent mb-2">
            Welcome back, {user?.name || 'Champion'}!
          </h1>
          <p className="text-gray-400 text-sm sm:text-base">
            Track your progress and stay consistent 🎯
          </p>
        </motion.div>

        {/* Activity Rings Dashboard */}
        <div className="space-y-6 mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Activity Ring */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="lg:col-span-1"
            >
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
              <CardContent className="p-8 flex flex-col items-center justify-center">
                <ActivityRing
                  rings={[
                    {
                      value: dailyStats.todaySteps,
                      max: dailyStepsGoal,
                      color: '#6366f1',
                      label: 'Steps'
                    },
                    {
                      value: dailyStats.currentStreak,
                      max: 30,
                      color: '#f97316',
                      label: 'Streak'
                    }
                  ]}
                  size={200}
                  strokeWidth={16}
                />
                <div className="mt-6 text-center">
                  <h3 className="text-lg font-semibold text-white mb-2">Today's Activity</h3>
                  <div className="flex gap-4 justify-center text-sm">
                    <div>
                      <div className="w-3 h-3 bg-indigo-400 rounded-full inline-block mr-1" />
                      <span className="text-gray-400">Steps</span>
                    </div>
                    <div>
                      <div className="w-3 h-3 bg-orange-400 rounded-full inline-block mr-1" />
                      <span className="text-gray-400">Streak</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Stats Grid - 2x2 layout with goals */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-4">
            {/* Steps with Goal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1 }}
            >
              <StepsGoalCard
                currentSteps={dailyStats.todaySteps}
                dailyGoal={dailyStepsGoal}
                onGoalSaved={fetchGoalWeight}
              />
            </motion.div>

            {/* Weight */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 }}
            >
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl h-full">
                <CardContent className="p-3 flex flex-col items-center justify-center h-full">
                  <CircularProgress
                    value={dailyStats.todayWeight || 0}
                    max={100}
                    size={80}
                    strokeWidth={8}
                    color="#8b5cf6"
                    icon={BathroomScale as any}
                    showValue={false}
                  />
                  <p className="text-xs text-gray-400 mt-2">Weight</p>
                  <p className="text-sm font-bold text-white">
                    {formatWeight(dailyStats.todayWeight, unitSystem)}
                  </p>
                </CardContent>
              </Card>
            </motion.div>

            {/* Weight Goal Tracker */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
            >
              <GoalProgressIndicator
                currentWeight={dailyStats.todayWeight ? weightKgToDisplay(dailyStats.todayWeight, unitSystem) : undefined}
                goalWeight={goalWeightKg ? weightKgToDisplay(goalWeightKg, unitSystem) : undefined}
                startingWeight={startingWeightKg ? weightKgToDisplay(startingWeightKg, unitSystem) : undefined}
                unit={unitSystem}
                onGoalSaved={fetchGoalWeight}
              />
            </motion.div>

            {/* Streak */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25 }}
            >
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl h-full">
                <CardContent className="p-3 flex flex-col items-center justify-center h-full">
                  <CircularProgress
                    value={dailyStats.currentStreak}
                    max={30}
                    size={80}
                    strokeWidth={8}
                    color="#f97316"
                    icon={Flame}
                    showValue={false}
                  />
                  <p className="text-xs text-gray-400 mt-2">Streak</p>
                  <p className="text-sm font-bold text-white">{dailyStats.currentStreak} days</p>
                </CardContent>
              </Card>
            </motion.div>

          </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="checkin" className="space-y-6">
          <TabsList className="w-full sm:w-auto grid grid-cols-2 sm:grid-cols-3 gap-2 bg-slate-900/50 border border-slate-800">
            <TabsTrigger value="checkin" className="text-sm data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400">
              <Plus className="h-4 w-4 mr-2" />
              Check-in
            </TabsTrigger>
            <TabsTrigger value="weight" className="text-sm data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">Weight</TabsTrigger>
            <TabsTrigger value="steps" className="text-sm data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400">Steps</TabsTrigger>
          </TabsList>

          {/* Daily Check-in Tab */}
          <TabsContent value="checkin" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-indigo-400" />
                    <CardTitle className="text-xl sm:text-2xl text-white">Quick Check-in</CardTitle>
                  </div>
                  <CardDescription className="text-gray-400">
                    Log today's progress in seconds
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCheckIn} className="space-y-6">
                    {/* Weight and Steps */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="weight" className="text-sm font-medium text-gray-300">
                            Weight ({getWeightUnit(unitSystem)})
                          </Label>
                          <UnitToggle
                            value={unitSystem}
                            onChange={setUnitSystem}
                            isLoading={isLoadingUnits}
                            size="sm"
                          />
                        </div>
                        <div className="relative">
                          <BathroomScale className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" size={16} />
                          <Input
                            id="weight"
                            type="number"
                            step="0.1"
                            placeholder={getWeightPlaceholder(unitSystem)}
                            className="pl-10 h-12 bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                            value={checkInForm.weight}
                            onChange={(e) => setCheckInForm({ ...checkInForm, weight: e.target.value })}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="steps" className="text-sm font-medium text-gray-300">Steps</Label>
                        <div className="relative">
                          <Footprints className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                          <Input
                            id="steps"
                            type="number"
                            placeholder="10000"
                            className="pl-10 h-12 bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                            value={checkInForm.steps}
                            onChange={(e) => setCheckInForm({ ...checkInForm, steps: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Circular Sliders for Mood & Energy */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 py-6">
                      <div className="flex justify-center">
                        <CircularSlider
                          value={checkInForm.mood}
                          onChange={(value) => setCheckInForm({ ...checkInForm, mood: value })}
                          min={1}
                          max={5}
                          size={160}
                          strokeWidth={14}
                          color="#6366f1"
                          label="Mood"
                          icon={Smile}
                        />
                      </div>

                      <div className="flex justify-center">
                        <CircularSlider
                          value={checkInForm.energy}
                          onChange={(value) => setCheckInForm({ ...checkInForm, energy: value })}
                          min={1}
                          max={5}
                          size={160}
                          strokeWidth={14}
                          color="#f97316"
                          label="Energy"
                          icon={Zap}
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label htmlFor="notes" className="text-sm font-medium text-gray-300">Notes (Optional)</Label>
                      <textarea
                        id="notes"
                        className="w-full px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-white placeholder:text-gray-500"
                        rows={2}
                        placeholder="How are you feeling today?"
                        value={checkInForm.notes}
                        onChange={(e) => setCheckInForm({ ...checkInForm, notes: e.target.value })}
                      />
                    </div>

                    {/* Save Button */}
                    <div className="flex justify-end pt-2">
                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        size="lg"
                        className="w-full sm:w-auto px-8 bg-purple-600 hover:bg-purple-700 shadow-lg hover:shadow-purple-500/50 transition-all"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="mr-2 h-4 w-4" />
                            Save Check-in
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </motion.div>

            {/* Recent Check-ins */}
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
              <CardHeader>
                <CardTitle className="text-lg text-white">Recent Activity</CardTitle>
                <CardDescription className="text-gray-400">Last 7 check-ins</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoadingCheckIns ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                  </div>
                ) : checkIns.length === 0 ? (
                  <div className="text-center py-12">
                    <Activity className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                    <p className="text-gray-400">No check-ins yet. Start tracking today!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {checkIns.slice(0, 7).map((checkIn) => (
                      <div
                        key={checkIn.id}
                        className="flex items-center justify-between p-3 sm:p-4 bg-slate-800/30 hover:bg-slate-800/50 rounded-lg transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Calendar className="h-4 w-4 text-gray-500 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-sm sm:text-base text-white">
                              {new Date(checkIn.tracking_date).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </p>
                            {checkIn.notes && (
                              <p className="text-xs sm:text-sm text-gray-400 truncate">
                                {checkIn.notes}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
                          {checkIn.weight_kg && (
                            <div className="flex items-center gap-1 text-xs sm:text-sm">
                              <BathroomScale className="h-3 w-3 sm:h-4 sm:w-4 text-purple-400" size={14} />
                              <span className="font-medium text-white">
                                {formatWeight(checkIn.weight_kg, unitSystem)}
                              </span>
                            </div>
                          )}
                          {checkIn.steps && (
                            <div className="flex items-center gap-1 text-xs sm:text-sm">
                              <Footprints className="h-3 w-3 sm:h-4 sm:w-4 text-indigo-400" />
                              <span className="font-medium text-white">{checkIn.steps.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Weight Trends Tab */}
          <TabsContent value="weight">
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <BathroomScale className="h-5 w-5" size={20} />
                  Weight Progress ({getWeightUnit(unitSystem)})
                </CardTitle>
                <CardDescription className="text-gray-400">Last 14 days</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                {chartData.filter(d => d.weight).length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <BathroomScale className="h-12 w-12 text-gray-600 mx-auto mb-3" size={48} />
                      <p className="text-gray-400">No weight data yet</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData.filter(d => d.weight)}>
                      <defs>
                        <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" className="text-xs" />
                      <YAxis stroke="#94a3b8" className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#fff'
                        }}
                        formatter={(value: any) => {
                          if (value === null || value === undefined) return ['--', ''];
                          return [`${value} ${getWeightUnit(unitSystem)}`, ''];
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="weight"
                        stroke="#8b5cf6"
                        strokeWidth={3}
                        fill="url(#weightGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Steps Trends Tab */}
          <TabsContent value="steps">
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Footprints className="h-5 w-5" />
                  Steps Progress
                </CardTitle>
                <CardDescription className="text-gray-400">Last 14 days</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                {chartData.filter(d => d.steps > 0).length === 0 ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <Footprints className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                      <p className="text-gray-400">No steps data yet</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                      <XAxis dataKey="date" stroke="#94a3b8" className="text-xs" />
                      <YAxis stroke="#94a3b8" className="text-xs" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#1e293b',
                          border: '1px solid #334155',
                          borderRadius: '8px',
                          color: '#fff'
                        }}
                      />
                      <Bar dataKey="steps" fill="#6366f1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </div>
      </div>
    </>
  );
}

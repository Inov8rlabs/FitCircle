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
  Check,
  Loader2
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
import { QuickEntryCard } from '@/components/QuickEntryCard';
import { BackfillDataDialog } from '@/components/BackfillDataDialog';
import { EngagementStreakCard } from '@/components/EngagementStreakCard';
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

  // Quick entry states
  const [quickWeight, setQuickWeight] = useState('');
  const [quickSteps, setQuickSteps] = useState('');
  const [previousUnitSystem, setPreviousUnitSystem] = useState(unitSystem);
  const [showBackfillDialog, setShowBackfillDialog] = useState(false);

  // Convert weight value when unit system changes
  useEffect(() => {
    if (quickWeight && unitSystem !== previousUnitSystem) {
      // Convert the displayed weight to the new unit system
      const currentValue = parseFloat(quickWeight);
      if (!isNaN(currentValue)) {
        let convertedValue: number;

        if (previousUnitSystem === 'metric' && unitSystem === 'imperial') {
          // kg to lbs
          convertedValue = currentValue * 2.20462;
        } else if (previousUnitSystem === 'imperial' && unitSystem === 'metric') {
          // lbs to kg
          convertedValue = currentValue / 2.20462;
        } else {
          convertedValue = currentValue;
        }

        setQuickWeight(convertedValue.toFixed(1));
      }
      setPreviousUnitSystem(unitSystem);
    } else if (unitSystem !== previousUnitSystem) {
      setPreviousUnitSystem(unitSystem);
    }
  }, [unitSystem, quickWeight, previousUnitSystem]);

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

      // Get the most recent weight entry (not just today's)
      const { data: latestWeightData } = await supabase
        .from('daily_tracking')
        .select('weight_kg, steps, tracking_date')
        .eq('user_id', user.id)
        .not('weight_kg', 'is', null)
        .order('tracking_date', { ascending: false })
        .limit(1)
        .maybeSingle() as { data: any };

      // Also get today's data for steps
      const { data: todayData } = await supabase
        .from('daily_tracking')
        .select('steps')
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
        todayWeight: latestWeightData?.weight_kg, // Use latest weight, not just today's
        weeklyAvgSteps,
        weightChange,
        currentStreak: streak,
        totalCheckIns: count || 0,
      });
    } catch (error) {
      console.error('Error fetching daily stats:', error);
    }
  };

  // Quick entry for weight
  const handleQuickWeightSubmit = async () => {
    if (!user || !quickWeight) return;

    const today = new Date().toISOString().split('T')[0];
    const weightInKg = parseWeightToKg(quickWeight, unitSystem);

    const { error } = await supabase
      .from('daily_tracking')
      .upsert({
        user_id: user.id,
        tracking_date: today,
        weight_kg: weightInKg,
      } as any, {
        onConflict: 'user_id,tracking_date'
      });

    if (error) throw error;

    toast.success('Weight logged!');
    setQuickWeight('');
    fetchCheckIns();
    fetchDailyStats();
  };

  // Quick entry for steps
  const handleQuickStepsSubmit = async () => {
    if (!user || !quickSteps) return;

    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase
      .from('daily_tracking')
      .upsert({
        user_id: user.id,
        tracking_date: today,
        steps: parseInt(quickSteps),
      } as any, {
        onConflict: 'user_id,tracking_date'
      });

    if (error) throw error;

    toast.success('Steps logged!');
    setQuickSteps('');
    fetchCheckIns();
    fetchDailyStats();
  };

  // Backfill past data
  const handleBackfillSubmit = async (data: { date: string; weight?: number; steps?: number }) => {
    if (!user) return;

    const { error } = await supabase
      .from('daily_tracking')
      .upsert({
        user_id: user.id,
        tracking_date: data.date,
        weight_kg: data.weight || null,
        steps: data.steps || null,
      } as any, {
        onConflict: 'user_id,tracking_date'
      });

    if (error) throw error;

    const dateDisplay = new Date(data.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    toast.success(`Data saved for ${dateDisplay}!`);
    fetchCheckIns();
    fetchDailyStats();
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
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-x-hidden">
        {/* Subtle circle background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl" />
          <div className="absolute top-40 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-1/3 w-[400px] h-[400px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 lg:py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 sm:mb-6 lg:mb-8"
        >
          <h1 className="text-2xl sm:text-3xl lg:text-5xl font-bold bg-gradient-to-r from-indigo-300 via-fuchsia-400 to-orange-400 bg-clip-text text-transparent mb-1.5 sm:mb-2">
            Welcome back, {user?.name || 'Champion'}!
          </h1>
          <p className="text-gray-400 text-xs sm:text-sm lg:text-base">
            Track your progress and stay consistent 🎯
          </p>
        </motion.div>

        {/* Quick Entry Section */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg lg:text-xl font-semibold text-white">Quick Log</h2>
            <button
              onClick={() => setShowBackfillDialog(true)}
              className="text-xs sm:text-sm text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
            >
              <Calendar className="h-3 w-3 sm:h-4 sm:w-4" />
              <span className="hidden sm:inline">Log past date</span>
              <span className="sm:hidden">Past date</span>
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              headerAction={
                <UnitToggle
                  value={unitSystem}
                  onChange={setUnitSystem}
                  isLoading={isLoadingUnits}
                  size="sm"
                />
              }
            />
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
          </div>
        </div>

        {/* Engagement Streak Highlight - Full Width on Mobile, Prominent on Desktop */}
        <div className="mb-6 sm:mb-8">
          <EngagementStreakCard />
        </div>

        {/* Activity Rings Dashboard */}
        <div className="space-y-4 sm:space-y-6 mb-6 sm:mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
            {/* Main Activity Ring */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="lg:col-span-1"
            >
              <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
              <CardContent className="p-4 sm:p-6 lg:p-8 flex flex-col items-center justify-center">
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
                  size={160}
                  strokeWidth={12}
                  className="sm:!w-[180px] sm:!h-[180px] lg:!w-[200px] lg:!h-[200px]"
                />
                <div className="mt-3 sm:mt-4 lg:mt-6 text-center">
                  <h3 className="text-sm sm:text-base lg:text-lg font-semibold text-white mb-1.5 sm:mb-2">Today's Activity</h3>
                  <div className="flex gap-2 sm:gap-3 lg:gap-4 justify-center text-xs sm:text-sm">
                    <div>
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-indigo-400 rounded-full inline-block mr-1" />
                      <span className="text-gray-400">Steps</span>
                    </div>
                    <div>
                      <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-orange-400 rounded-full inline-block mr-1" />
                      <span className="text-gray-400">Streak</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Stats Grid - 2x2 layout with goals */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-3 sm:gap-4">
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
        <Tabs defaultValue="weight" className="space-y-4 sm:space-y-6">
          <TabsList className="w-full sm:w-auto grid grid-cols-2 gap-2 bg-slate-900/50 border border-slate-800">
            <TabsTrigger value="weight" className="text-xs sm:text-sm data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">
              <BathroomScale className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" size={16} />
              <span className="hidden sm:inline">Weight Trends</span>
              <span className="sm:hidden">Weight</span>
            </TabsTrigger>
            <TabsTrigger value="steps" className="text-xs sm:text-sm data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400">
              <Footprints className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              <span className="hidden sm:inline">Steps Trends</span>
              <span className="sm:hidden">Steps</span>
            </TabsTrigger>
          </TabsList>

          {/* Weight Trends Tab */}
          <TabsContent value="weight">
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl shadow-2xl">
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-white text-base sm:text-lg">
                  <BathroomScale className="h-4 w-4 sm:h-5 sm:w-5" size={20} />
                  Weight Progress ({getWeightUnit(unitSystem)})
                </CardTitle>
                <CardDescription className="text-gray-400 text-xs sm:text-sm">Last 14 days</CardDescription>
              </CardHeader>
              <CardContent className="h-64 sm:h-80 p-3 sm:p-6">
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
              <CardHeader className="p-4 sm:p-6">
                <CardTitle className="flex items-center gap-2 text-white text-base sm:text-lg">
                  <Footprints className="h-4 w-4 sm:h-5 sm:w-5" />
                  Steps Progress
                </CardTitle>
                <CardDescription className="text-gray-400 text-xs sm:text-sm">Last 14 days</CardDescription>
              </CardHeader>
              <CardContent className="h-64 sm:h-80 p-3 sm:p-6">
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

      {/* Backfill Data Dialog */}
      <BackfillDataDialog
        open={showBackfillDialog}
        onOpenChange={setShowBackfillDialog}
        onSubmit={handleBackfillSubmit}
        unitSystem={unitSystem}
        weightUnit={getWeightUnit(unitSystem)}
      />
    </>
  );
}

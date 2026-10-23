'use client';

/**
 * Activity tab — web port of iOS `ExerciseLogView`, plus the steps and
 * check-in history that iOS keeps on Home. Three segments:
 *   Workouts  · category chips, day groups, workout rows, + sheet
 *   Steps     · today, This Week bars, daily list
 *   Check-ins · CheckInHistoryList (detail sheet, delete, privacy)
 * `?tab=steps|checkins` deep-links a segment (the dashboard links here).
 */
import { Clock, Dumbbell, Flame, Plus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  fetchStepsGoal,
  fetchTracking,
  fetchWorkouts,
  fetchWorkoutStats,
  type TrackingRow,
} from '@/components/activity/api';
import { CheckInHistoryList } from '@/components/activity/CheckInHistoryList';
import { StepsPanel } from '@/components/activity/StepsPanel';
import { WorkoutForm } from '@/components/activity/WorkoutForm';
import { WorkoutList } from '@/components/activity/WorkoutList';
import { Navbar } from '@/components/layout/navbar';
import { Fab, GlassCard, Screen, ScreenHeader, ToneDisc } from '@/components/ui/ios';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { exerciseClient } from '@/lib/api/exercise-client';
import type { ExerciseLog, ExerciseStatsResponse } from '@/lib/types/exercise';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

type Tab = 'workouts' | 'steps' | 'checkins';
const TABS: { id: Tab; label: string }[] = [
  { id: 'workouts', label: 'Workouts' },
  { id: 'steps', label: 'Steps' },
  { id: 'checkins', label: 'Check-ins' },
];

function isTab(v: string | null): v is Tab {
  return v === 'workouts' || v === 'steps' || v === 'checkins';
}

export default function ExerciseLogPage() {
  return (
    <Suspense fallback={null}>
      <ActivityScreen />
    </Suspense>
  );
}

function ActivityScreen() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'workouts';

  const [logs, setLogs] = useState<ExerciseLog[]>([]);
  const [stats, setStats] = useState<(ExerciseStatsResponse & { total_calories?: number }) | null>(null);
  const [loadingWorkouts, setLoadingWorkouts] = useState(true);
  const [tracking, setTracking] = useState<TrackingRow[] | null>(null);
  const [stepsGoal, setStepsGoal] = useState(10_000);
  const [addOpen, setAddOpen] = useState(false);

  const loadWorkouts = useCallback(async () => {
    const [list, st] = await Promise.allSettled([fetchWorkouts(100), fetchWorkoutStats('week')]);
    if (list.status === 'fulfilled') setLogs(list.value);
    else console.warn('[activity] workouts failed', list.reason);
    if (st.status === 'fulfilled') setStats(st.value);
    setLoadingWorkouts(false);
  }, []);

  const loadTracking = useCallback(async () => {
    if (!user?.id) return;
    const [rows, goal] = await Promise.allSettled([fetchTracking(user.id, 90), fetchStepsGoal(user.id)]);
    setTracking(rows.status === 'fulfilled' ? rows.value : []);
    if (goal.status === 'fulfilled') setStepsGoal(goal.value);
  }, [user?.id]);

  useEffect(() => {
    void loadWorkouts();
  }, [loadWorkouts]);

  useEffect(() => {
    void loadTracking();
  }, [loadTracking]);

  const selectTab = (next: Tab) => {
    const q = new URLSearchParams(params.toString());
    if (next === 'workouts') q.delete('tab');
    else q.set('tab', next);
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handleDelete = async (log: ExerciseLog) => {
    if (!confirm(`Delete ${log.exercise_type}?`)) return;
    try {
      await exerciseClient.delete(log.id);
      setLogs((prev) => prev.filter((l) => l.id !== log.id));
      toast.success('Exercise removed');
      void loadWorkouts();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar />
      <Screen className="max-w-5xl">
        <ScreenHeader title="Activity" subtitle="Workouts, steps and check-ins" />

        <div
          role="tablist"
          aria-label="Activity sections"
          className="mb-5 grid h-11 grid-cols-3 rounded-xl border border-hairline bg-white/5 p-1 md:max-w-md"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => selectTab(t.id)}
              className={cn(
                'rounded-lg text-subhead font-semibold transition duration-200 ease-ios',
                tab === t.id ? 'bg-surface-raised text-white shadow-ios-sm' : 'text-fg-secondary hover:text-white'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'workouts' && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
              <WorkoutList logs={logs} loading={loadingWorkouts} onDelete={handleDelete} onAdd={() => setAddOpen(true)} />
              <WeekSummary stats={stats} loading={loadingWorkouts} />
            </div>
          )}
          {tab === 'steps' && <StepsPanel rows={tracking ?? []} goal={stepsGoal} loading={tracking === null} />}
          {tab === 'checkins' && (
            <div className="max-w-2xl">
              <CheckInHistoryList
                rows={tracking ?? undefined}
                title={null}
                pageSize={10}
                onChanged={() => void loadTracking()}
              />
            </div>
          )}
        </div>
      </Screen>

      {tab === 'workouts' && <Fab icon={Plus} label="Log workout" onClick={() => setAddOpen(true)} />}

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Log workout</SheetTitle>
            <SheetDescription>Workouts from Apple Health and Health Connect sync on their own.</SheetDescription>
          </SheetHeader>
          <WorkoutForm
            onCancel={() => setAddOpen(false)}
            onSaved={() => {
              setAddOpen(false);
              void loadWorkouts();
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function WeekSummary({
  stats,
  loading,
}: {
  stats: (ExerciseStatsResponse & { total_calories?: number }) | null;
  loading: boolean;
}) {
  const items = [
    { icon: Dumbbell, tone: 'purple' as const, label: 'Workouts', value: stats?.total_workouts ?? 0 },
    { icon: Clock, tone: 'cyan' as const, label: 'Minutes', value: stats?.total_minutes ?? 0 },
    { icon: Flame, tone: 'orange' as const, label: 'Calories', value: Math.round(stats?.total_calories ?? 0) },
  ];
  return (
    <GlassCard className="order-first lg:order-none lg:sticky lg:top-24" data-testid="week-summary">
      <h2 className="mb-3 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">This week</h2>
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col items-start gap-2 lg:flex-row lg:items-center lg:gap-3">
            <ToneDisc icon={it.icon} tone={it.tone} size="sm" />
            <div>
              {loading ? (
                <Skeleton className="h-6 w-12" />
              ) : (
                <p className="text-title3 tabular-nums text-white">{it.value.toLocaleString()}</p>
              )}
              <p className="text-caption text-fg-secondary">{it.label}</p>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

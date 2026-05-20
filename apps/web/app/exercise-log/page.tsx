'use client';

/**
 * Exercise log page — web port of iOS `ExerciseLogView`. List recent
 * workouts, show weekly stats, and link to /exercise-log/new for entry.
 */

import { motion } from 'framer-motion';
import {
  Dumbbell, Flame, Clock, Activity, Plus, Trash2, TrendingUp, Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { exerciseClient } from '@/lib/api/exercise-client';
import type { ExerciseLog, ExerciseStatsResponse } from '@/lib/types/exercise';
import { useAuthStore } from '@/stores/auth-store';

export default function ExerciseLogPage() {
  const { isAuthenticated } = useAuthStore();
  const [logs, setLogs] = useState<ExerciseLog[]>([]);
  const [stats, setStats] = useState<ExerciseStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [listRes, statsRes] = await Promise.allSettled([
        exerciseClient.list({ limit: 50 }),
        exerciseClient.getStats('week'),
      ]);
      if (listRes.status === 'fulfilled') setLogs(listRes.value.exercises);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value);
    } catch (e) {
      console.warn('[exercise-log] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this exercise?')) return;
    try {
      await exerciseClient.delete(id);
      setLogs(prev => prev.filter(l => l.id !== id));
      toast.success('Exercise removed');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not delete');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your exercise log.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Exercise Log</h1>
          <Link href="/exercise-log/new">
            <Button className="bg-orange-500 hover:bg-orange-600 gap-1">
              <Plus className="h-4 w-4" /> Log workout
            </Button>
          </Link>
        </div>

        {stats && <StatsRow stats={stats} />}

        {isLoading ? (
          <Card><CardContent className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : logs.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <ExerciseRow key={log.id} log={log} onDelete={() => handleDelete(log.id)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function StatsRow({ stats }: { stats: ExerciseStatsResponse }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <StatCard label="Workouts" value={stats.total_workouts} icon={<Dumbbell className="h-4 w-4" />} color="text-purple-400" />
      <StatCard label="Minutes" value={stats.total_minutes} icon={<Clock className="h-4 w-4" />} color="text-orange-400" />
      <StatCard label="Calories" value={Math.round(stats.total_workouts > 0 ? (stats as any).total_calories ?? 0 : 0)} icon={<Flame className="h-4 w-4" />} color="text-red-400" />
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className={`flex items-center justify-center gap-1 ${color}`}>
          {icon}
          <p className="text-xl font-bold">{value}</p>
        </div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      </CardContent>
    </Card>
  );
}

function ExerciseRow({ log, onDelete }: { log: ExerciseLog; onDelete: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center ${CATEGORY_BG[log.category] ?? 'bg-zinc-800'}`}>
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate capitalize">{log.exercise_type}</p>
            <p className="text-xs text-muted-foreground">
              {log.duration_minutes} min
              {log.calories_burned ? ` · ${log.calories_burned} cal` : ''}
              {log.effort_level ? ` · RPE ${log.effort_level}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive p-1"
            aria-label="Delete exercise"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="p-12 text-center space-y-3">
        <Dumbbell className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-semibold">No workouts yet</p>
        <p className="text-sm text-muted-foreground">
          Tap "Log workout" to record your first exercise.
        </p>
        <Link href="/exercise-log/new">
          <Button className="mt-4 bg-orange-500 hover:bg-orange-600">
            <Plus className="h-4 w-4 mr-1" /> Log first workout
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

const CATEGORY_BG: Record<string, string> = {
  cardio: 'bg-red-500',
  strength: 'bg-purple-500',
  flexibility: 'bg-cyan-500',
  sports: 'bg-orange-500',
  outdoor: 'bg-emerald-500',
  other: 'bg-zinc-600',
};

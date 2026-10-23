'use client';

import { useCallback, useEffect, useState } from 'react';

import { STREAK_AUTO_CLAIMED_EVENT } from '@/lib/streaks/auto-claim-events';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

export interface TrackingRow {
  id: string;
  tracking_date: string;
  weight_kg?: number | null;
  steps?: number | null;
  steps_source?: string | null;
  mood_score?: number | null;
  energy_level?: number | null;
  notes?: string | null;
  created_at: string;
}

export interface TrackingGoals {
  stepsGoal: number;
  weightGoalKg?: number;
  startingWeightKg?: number;
}

/** Local YYYY-MM-DD (the dashboard's "today", same as the old page). */
export function isoDay(d: Date = new Date()): string {
  return d.toISOString().split('T')[0];
}

/**
 * The dashboard's daily_tracking history (last 60 rows) and the step / weight
 * goals from profiles.goals: the same reads the previous dashboard made.
 */
export function useTracking() {
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [goals, setGoals] = useState<TrackingGoals>({ stepsGoal: 10000 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [{ data: tracking }, { data: profile }] = await Promise.all([
        supabase.from('daily_tracking').select('*').eq('user_id', user.id).order('tracking_date', { ascending: false }).limit(60),
        supabase.from('profiles').select('goals').eq('id', user.id).single(),
      ]);
      setRows(((tracking as TrackingRow[] | null) ?? []).slice().sort((a, b) => b.tracking_date.localeCompare(a.tracking_date)));
      const list = (profile as { goals?: unknown } | null)?.goals;
      if (Array.isArray(list)) {
        const weight = list.find((g: { type?: string }) => g?.type === 'weight') as
          | { target_weight_kg?: number; starting_weight_kg?: number }
          | undefined;
        const steps = list.find((g: { type?: string }) => g?.type === 'steps') as { daily_steps_target?: number } | undefined;
        setGoals({
          stepsGoal: steps?.daily_steps_target || 10000,
          weightGoalKg: weight?.target_weight_kg,
          startingWeightKg: weight?.starting_weight_kg,
        });
      }
    } catch (error) {
      console.error('Error loading tracking history:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onClaim = () => void load();
    window.addEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
    return () => window.removeEventListener(STREAK_AUTO_CLAIMED_EVENT, onClaim);
  }, [load]);

  /** Upsert one day's weight and/or steps (same write as the old Quick Log / backfill). */
  const saveDay = useCallback(
    async (date: string, values: { weight_kg?: number; steps?: number }) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('daily_tracking')
        .upsert({ user_id: user.id, tracking_date: date, ...values } as never, { onConflict: 'user_id,tracking_date' });
      if (error) throw error;
      await load();
    },
    [user, load]
  );

  const today = rows.find((r) => r.tracking_date === isoDay());
  const latestWeight = rows.find((r) => typeof r.weight_kg === 'number' && r.weight_kg > 0);

  return { rows, goals, loading, reload: load, saveDay, today, latestWeight };
}

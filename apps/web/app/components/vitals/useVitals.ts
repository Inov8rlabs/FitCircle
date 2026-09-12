'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { nutritionClient } from '@/lib/api/nutrition-client';
import { vitalsClient } from '@/lib/api/vitals-client';
import { announceStreakAutoClaim, STREAK_AUTO_CLAIMED_EVENT } from '@/lib/streaks/auto-claim-events';
import type { VitalsGoalsUpdate, VitalsSummary } from '@/lib/types/vitals';
import { useAuthStore } from '@/stores/auth-store';

export interface UseVitalsResult {
  summary: VitalsSummary | null;
  loading: boolean;
  error: string | null;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /** PUT goals; the returned summary replaces the current one. Throws on failure. */
  saveGoals: (body: VitalsGoalsUpdate) => Promise<VitalsSummary>;
  /** POST a water food-log entry (ml) and refresh the summary. */
  logWater: (ml: number) => Promise<void>;
}

/**
 * Loads the 7-day vitals summary for the signed-in user. Re-fetches on the
 * `streak-auto-claimed` window event (every new meal/drink log announces it,
 * and a new drink changes the water card).
 */
export function useVitals(days = 7): UseVitalsResult {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const [summary, setSummary] = useState<VitalsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignore responses from a request that started before a newer one.
  const requestSeq = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!userId) return;
    const seq = ++requestSeq.current;
    if (!opts?.silent) setLoading(true);
    try {
      const next = await vitalsClient.getSummary(days);
      if (seq !== requestSeq.current) return;
      setSummary(next);
      setError(null);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      console.error('Error loading vitals summary:', err);
      setError(err instanceof Error ? err.message : 'Failed to load vitals');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [userId, days]);

  useEffect(() => {
    if (!userId) {
      setSummary(null);
      return;
    }
    void refresh();
  }, [userId, refresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      void refresh({ silent: true });
    };
    window.addEventListener(STREAK_AUTO_CLAIMED_EVENT, handler);
    return () => window.removeEventListener(STREAK_AUTO_CLAIMED_EVENT, handler);
  }, [refresh]);

  const saveGoals = useCallback(async (body: VitalsGoalsUpdate) => {
    const next = await vitalsClient.updateGoals(body);
    // A save supersedes any in-flight refresh.
    requestSeq.current++;
    setSummary(next);
    setError(null);
    setLoading(false);
    return next;
  }, []);

  const logWater = useCallback(async (ml: number) => {
    const clamped = Math.min(10_000, Math.max(1, Math.round(ml)));
    const { streak } = await nutritionClient.createFoodLog({
      entry_type: 'water',
      water_ml: clamped,
      is_private: true,
    });
    announceStreakAutoClaim(streak);
    await refresh({ silent: true });
  }, [refresh]);

  return { summary, loading, error, refresh, saveGoals, logWater };
}

'use client';

import { useEffect, useState, useCallback } from 'react';

export interface DailyGoal {
  id: string;
  user_id: string;
  challenge_id: string | null;
  goal_type: 'steps' | 'weight_log' | 'workout' | 'mood' | 'energy' | 'custom';
  target_value: number | null;
  unit: string | null;
  start_date: string;
  end_date: string | null;
  frequency: 'daily' | 'weekdays' | 'weekends' | 'custom';
  is_active: boolean;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface GoalProgress {
  goal_id: string;
  goal_type: string;
  target_value: number | null;
  actual_value: number | null;
  completion_percentage: number;
  is_completed: boolean;
  unit: string | null;
}

export interface DailyProgress {
  date: string;
  goals: GoalProgress[];
  overall_completion: number;
  total_goals: number;
  completed_goals: number;
}

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  last_completion_date: string | null;
}

interface DailyGoalsData {
  goals: DailyGoal[];
  progress: DailyProgress | null;
  streak: StreakInfo;
}

/**
 * React hook for managing daily goals
 *
 * Usage:
 * ```tsx
 * const { goals, progress, streak, isLoading, error, refresh } = useDailyGoals();
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error message={error.message} />;
 *
 * return (
 *   <div>
 *     <h2>Today's Progress: {progress?.overall_completion}%</h2>
 *     <p>Current Streak: {streak.current_streak} days</p>
 *   </div>
 * );
 * ```
 */
export function useDailyGoals() {
  const [goals, setGoals] = useState<DailyGoal[]>([]);
  const [progress, setProgress] = useState<DailyProgress | null>(null);
  const [streak, setStreak] = useState<StreakInfo>({
    current_streak: 0,
    longest_streak: 0,
    last_completion_date: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch progress and streak
      const progressRes = await fetch('/api/daily-goals/progress');
      if (!progressRes.ok) {
        throw new Error('Failed to fetch progress');
      }
      const progressData = await progressRes.json();
      setProgress(progressData.progress);
      setStreak(progressData.streak);

      // Fetch goals
      const goalsRes = await fetch('/api/daily-goals');
      if (!goalsRes.ok) {
        throw new Error('Failed to fetch goals');
      }
      const goalsData = await goalsRes.json();
      setGoals(goalsData.goals || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Refresh every minute
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    goals,
    progress,
    streak,
    isLoading,
    isError: !!error,
    error,
    refresh: fetchData,
  };
}

/**
 * Hook for fetching completion history
 *
 * Usage:
 * ```tsx
 * const { history, isLoading, error } = useDailyGoalsHistory(30);
 * ```
 */
export function useDailyGoalsHistory(limit: number = 30) {
  const [history, setHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(`/api/daily-goals/history?limit=${limit}`);
      if (!res.ok) {
        throw new Error('Failed to fetch history');
      }
      const data = await res.json();
      setHistory(data.history || []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    isLoading,
    isError: !!error,
    error,
    refresh: fetchHistory,
  };
}

/**
 * Hook for managing a single goal
 *
 * Usage:
 * ```tsx
 * const { refresh } = useDailyGoals();
 * const { updateGoal, deleteGoal, setPrimary, isUpdating } = useDailyGoal(goalId, refresh);
 *
 * await updateGoal({ target_value: 10000 });
 * await setPrimary();
 * ```
 */
export function useDailyGoal(goalId: string, refreshCallback?: () => Promise<void>) {
  const [isUpdating, setIsUpdating] = useState(false);

  const updateGoal = async (updates: { target_value?: number; is_primary?: boolean }) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/daily-goals/${goalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        throw new Error('Failed to update goal');
      }

      if (refreshCallback) {
        await refreshCallback();
      }
      return await res.json();
    } finally {
      setIsUpdating(false);
    }
  };

  const deleteGoal = async () => {
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/daily-goals/${goalId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete goal');
      }

      if (refreshCallback) {
        await refreshCallback();
      }
      return await res.json();
    } finally {
      setIsUpdating(false);
    }
  };

  const setPrimary = async () => {
    return updateGoal({ is_primary: true });
  };

  return {
    updateGoal,
    deleteGoal,
    setPrimary,
    isUpdating,
  };
}

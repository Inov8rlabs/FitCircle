/**
 * Activity screen data access. Same endpoints and payloads as the mobile apps
 * (`/api/mobile/exercises*`, `daily_tracking`); this module only normalizes the
 * response envelopes.
 *
 * Why not `exerciseClient` directly: the routes answer `{ success, data: [...] }`
 * (list) and `{ success, data: {...} }` (stats), while `exerciseClient.list`
 * is typed as `{ exercises, total }` — reading `.exercises` always gave
 * undefined, so the old page never showed a workout. Also, the store token can
 * still be null on first paint; `verifyMobileAuth` accepts the session cookie,
 * so we send the cookie and add the Bearer token only when we have one.
 */
import { supabase } from '@/lib/supabase';
import type { ExerciseLog, ExerciseStatsResponse } from '@/lib/types/exercise';
import { useAuthStore } from '@/stores/auth-store';

async function apiGet<T>(path: string): Promise<T> {
  const token = useAuthStore.getState().token;
  const res = await fetch(path, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: { message?: string } | string })?.error;
    throw new Error(typeof err === 'string' ? err : err?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

/** Accepts `{ data: [...] }`, `{ exercises: [...] }` or a bare array. */
export function normalizeExerciseList(json: unknown): ExerciseLog[] {
  if (Array.isArray(json)) return json as ExerciseLog[];
  const o = (json ?? {}) as { data?: unknown; exercises?: unknown };
  if (Array.isArray(o.data)) return o.data as ExerciseLog[];
  if (o.data && typeof o.data === 'object' && Array.isArray((o.data as { exercises?: unknown }).exercises)) {
    return (o.data as { exercises: ExerciseLog[] }).exercises;
  }
  if (Array.isArray(o.exercises)) return o.exercises as ExerciseLog[];
  return [];
}

/** Accepts `{ data: stats }` or bare stats. */
export function normalizeExerciseStats(json: unknown): (ExerciseStatsResponse & { total_calories?: number }) | null {
  const o = (json ?? {}) as { data?: unknown; total_workouts?: unknown };
  const s = (o.data && typeof o.data === 'object' ? o.data : o) as ExerciseStatsResponse & { total_calories?: number };
  return typeof s.total_workouts === 'number' ? s : null;
}

export async function fetchWorkouts(limit = 100): Promise<ExerciseLog[]> {
  return normalizeExerciseList(await apiGet<unknown>(`/api/mobile/exercises?limit=${limit}`));
}

export async function fetchWorkoutStats(period: 'day' | 'week' | 'month' = 'week') {
  return normalizeExerciseStats(await apiGet<unknown>(`/api/mobile/exercises/stats?period=${period}`));
}

export interface TrackingRow {
  id: string;
  tracking_date: string;
  weight_kg?: number | null;
  steps?: number | null;
  mood_score?: number | null;
  energy_level?: number | null;
  notes?: string | null;
  is_public?: boolean | null;
  created_at: string;
}

/** Most recent daily_tracking rows for the user (same query the dashboard used). */
export async function fetchTracking(userId: string, limit = 60): Promise<TrackingRow[]> {
  const { data, error } = await supabase
    .from('daily_tracking')
    .select('*')
    .eq('user_id', userId)
    .order('tracking_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as TrackingRow[];
}

/** Daily steps goal from profile.goals (type 'steps'), else 10,000 (iOS AppTheme.Goals.stepsGoal). */
export async function fetchStepsGoal(userId: string): Promise<number> {
  try {
    const { data } = await supabase.from('profiles').select('goals').eq('id', userId).single();
    const goals = (data as { goals?: unknown } | null)?.goals;
    if (Array.isArray(goals)) {
      const g = goals.find((x: { type?: string }) => x?.type === 'steps') as { daily_steps_target?: number } | undefined;
      if (g?.daily_steps_target && g.daily_steps_target > 0) return g.daily_steps_target;
    }
  } catch {
    // default below
  }
  return 10_000;
}

/** YYYY-MM-DD in local time. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses YYYY-MM-DD as a local date (not UTC midnight). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.slice(0, 10).split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

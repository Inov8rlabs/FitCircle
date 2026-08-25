import type {
  ExerciseLog,
  ExerciseLogCreateInput,
  ExerciseStatsResponse,
} from '@/lib/types/exercise';
import { useAuthStore } from '@/stores/auth-store';
import { clientTimezone, extractStreakMeta } from '@/lib/streaks/auto-claim-events';

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return json as T;
}

export const exerciseClient = {
  list: (params: { startDate?: string; endDate?: string; limit?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.startDate) search.set('start_date', params.startDate);
    if (params.endDate) search.set('end_date', params.endDate);
    if (params.limit) search.set('limit', String(params.limit));
    const qs = search.toString();
    return authedFetch<{ exercises: ExerciseLog[]; total: number }>(
      `/api/mobile/exercises${qs ? `?${qs}` : ''}`
    );
  },

  /**
   * Create a workout. Manual entries are auto-claimed for the streak on the
   * server; the outcome rides back in `meta.streak` (returned as `streak`).
   */
  create: async (input: ExerciseLogCreateInput) => {
    const json = await authedFetch<{ data: ExerciseLog; meta?: unknown }>('/api/mobile/exercises', {
      method: 'POST',
      body: JSON.stringify({ ...input, timezone: clientTimezone() }),
    });
    return { exercise: json.data, streak: extractStreakMeta(json) };
  },

  delete: (id: string) =>
    authedFetch<{ success: boolean }>(`/api/mobile/exercises/${id}`, { method: 'DELETE' }),

  getStats: (period: 'day' | 'week' | 'month' = 'week') =>
    authedFetch<ExerciseStatsResponse>(`/api/mobile/exercises/stats?period=${period}`),

  getRecentTypes: () =>
    authedFetch<{ types: Array<{ exercise_type: string; category: string }> }>(
      '/api/mobile/exercises/recent-types'
    ),
};

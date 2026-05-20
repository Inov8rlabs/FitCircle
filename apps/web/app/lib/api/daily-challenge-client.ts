/**
 * Client-side wrapper for daily-challenge backend calls.
 * Shape mirrors `app/lib/services/daily-challenge-service.ts` types.
 */

import { useAuthStore } from '@/stores/auth-store';

export interface DailyChallenge {
  id: string;
  challenge_date: string;
  name: string;
  description: string | null;
  goal_amount: number;
  unit: string;
  participant_count: number;
  completion_count: number;
  difficulty: string | null;
  icon_name: string | null;
  challenge_category: string | null;
  is_custom: boolean;
}

export interface DailyChallengeWithProgress extends DailyChallenge {
  user_progress: number | null;
  user_completed: boolean;
  user_joined: boolean;
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  progress: number;
  is_completed: boolean;
  completed_at: string | null;
}

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

export const dailyChallengeClient = {
  getCurrent: () => authedFetch<DailyChallengeWithProgress>('/api/mobile/challenges/daily'),

  join: (challengeId: string) =>
    authedFetch<{ success: boolean }>(`/api/mobile/challenges/daily/${challengeId}/join`, {
      method: 'POST',
    }),

  updateProgress: (challengeId: string, progress: number) =>
    authedFetch<DailyChallengeWithProgress>(`/api/mobile/challenges/daily/${challengeId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ progress }),
    }),

  getLeaderboard: (challengeId: string) =>
    authedFetch<{ entries: LeaderboardEntry[] }>(
      `/api/mobile/challenges/daily/${challengeId}/leaderboard`
    ),
};

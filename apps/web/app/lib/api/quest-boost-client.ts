import { useAuthStore } from '@/stores/auth-store';

export interface QuestWithProgress {
  id: string;
  fitcircle_id: string;
  challenge_id: string | null;
  template_id: string | null;
  quest_name: string;
  quest_description: string | null;
  quest_type: string;
  goal_amount: number;
  unit: string;
  collective_target: number | null;
  collective_progress: number;
  starts_at: string;
  ends_at: string;
  status: string;
  metadata: Record<string, unknown>;
  my_progress: number;
  my_completed: boolean;
  participant_count: number;
  days_remaining: number;
  completion_pct: number;
}

export interface BoostStatus {
  fitcircle_id: string;
  boost_date: string;
  total_members: number;
  checked_in_members: number;
  boost_multiplier: number;
  is_perfect_day: boolean;
  member_statuses: Array<{
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    checked_in: boolean;
  }>;
}

export interface BoostHistoryEntry {
  boost_date: string;
  total_members: number;
  checked_in_members: number;
  boost_multiplier: number;
  is_perfect_day: boolean;
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

export const questClient = {
  listForCircle: (circleId: string) =>
    authedFetch<{ quests: QuestWithProgress[] }>(`/api/mobile/circles/${circleId}/quests`),

  getQuest: (circleId: string, questId: string) =>
    authedFetch<{ quest: QuestWithProgress }>(`/api/mobile/circles/${circleId}/quests/${questId}`),

  updateProgress: (circleId: string, questId: string, progress: number) =>
    authedFetch<{ quest: QuestWithProgress }>(
      `/api/mobile/circles/${circleId}/quests/${questId}/progress`,
      {
        method: 'POST',
        body: JSON.stringify({ progress }),
      }
    ),
};

export const boostClient = {
  getStatus: (circleId: string) =>
    authedFetch<BoostStatus>(`/api/mobile/circles/${circleId}/boost`),

  getHistory: (circleId: string, days = 7) =>
    authedFetch<{ history: BoostHistoryEntry[] }>(
      `/api/mobile/circles/${circleId}/boost/history?days=${days}`
    ),
};

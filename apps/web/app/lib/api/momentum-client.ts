import { useAuthStore } from '@/stores/auth-store';

export interface MomentumStatus {
  current_momentum: number;
  best_momentum: number;
  flame_level: number;
  flame_label: string;
  grace_day_available: boolean;
  grace_day_used_this_week: boolean;
  next_milestone: MomentumMilestone | null;
  days_to_next_milestone: number | null;
  last_check_in_date: string | null;
  checked_in_today: boolean;
}

export interface MomentumMilestone {
  days: number;
  name: string;
  description: string;
  badge: string;
  unlocked: boolean;
  unlocked_at?: string;
}

export interface MomentumCheckInResult {
  new_momentum: number;
  best_momentum: number;
  flame_level: number;
  flame_label: string;
  is_first_check_in_today: boolean;
  milestone_achieved: MomentumMilestone | null;
  grace_day_available: boolean;
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

export const momentumClient = {
  getStatus: () => authedFetch<MomentumStatus>('/api/mobile/momentum/status'),
  getMilestones: () => authedFetch<{ milestones: MomentumMilestone[] }>('/api/mobile/momentum/milestones'),
  checkIn: () => authedFetch<MomentumCheckInResult>('/api/mobile/momentum/check-in', { method: 'POST' }),
};

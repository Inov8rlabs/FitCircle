/**
 * Client-side wrapper for streak-related backend calls.
 *
 * The web app and the mobile apps share the same `/api/streaks/*` endpoints.
 * Those routes use `requireMobileAuth` (Bearer token from `Authorization`
 * header) — the same access token that Supabase issues on web sign-in. This
 * file is the tiny adapter that pulls the token from the Zustand auth store
 * and shapes it into a fetch.
 *
 * All functions return the parsed JSON response or throw on non-2xx.
 */

import { useAuthStore } from '@/stores/auth-store';

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function call<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');

  const url = new URL(path, window.location.origin);
  if (opts.query) {
    Object.entries(opts.query).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, v);
    });
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Types — match the backend response shapes

export interface StreakEngagement {
  current_streak: number;
  longest_streak: number;
  streak_freezes_available: number;
  paused: boolean;
  pause_end_date: string | null;
  last_engagement_date: string | null;
}

export interface ClaimableDay {
  date: string;
  claimed: boolean;
  hasHealthData: boolean;
  canClaim: boolean;
  reason?: string;
  stepCount?: number | null;
  isFrozen?: boolean;
}

export interface ShieldStatus {
  available: number;
  max: number;
  used: number;
  next_free_at: string | null;
  can_activate: boolean;
}

export interface ClaimResult {
  success: boolean;
  current_streak: number;
  message?: string;
  milestone?: { days: number; title: string; badge: string; message: string } | null;
}

export interface FreezeResult {
  success: boolean;
  date: string;
  freezes_remaining: number;
  message: string;
}

export interface EngagementHistoryEntry {
  date: string;
  activities: string[];
  activity_count: number;
}

// ---------------------------------------------------------------------------
// API surface

export const streakClient = {
  getEngagement: () =>
    call<StreakEngagement>('/api/streaks/engagement'),

  getClaimableDays: (timezone: string) =>
    call<{ days: ClaimableDay[] }>('/api/streaks/claimable-days', { query: { timezone } }),

  getClaimStatus: (date: string, timezone: string) =>
    call<{
      date: string;
      isClaimed: boolean;
      isClaimable: boolean;
      reason: string | null;
      healthDataSynced: boolean;
    }>('/api/streaks/claim-status', { query: { date, timezone } }),

  getShields: () =>
    call<ShieldStatus>('/api/streaks/shields'),

  claimStreak: (claimDate: string | null, timezone: string) =>
    call<ClaimResult>('/api/streaks/claim', {
      method: 'POST',
      body: { claimDate, timezone },
    }),

  activateFreeze: (date: string, timezone: string) =>
    call<FreezeResult>('/api/streaks/freeze', {
      method: 'POST',
      body: { date, timezone },
    }),

  getHistory: (days = 30) =>
    call<{ entries: EngagementHistoryEntry[] }>('/api/streaks/engagement', {
      query: { history: 'true', days: String(days) },
    }).catch(() => ({ entries: [] as EngagementHistoryEntry[] })),
};

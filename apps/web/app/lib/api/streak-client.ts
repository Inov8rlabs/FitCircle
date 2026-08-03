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
  /** Pro users have unlimited shields — render ∞ and ignore `available`. */
  unlimited: boolean;
}

export interface ClaimResult {
  success: boolean;
  /** New streak length after the claim. */
  streakCount: number;
  message?: string;
  /**
   * Server MilestoneInfo: `milestone` is the day count reached;
   * `shieldsGranted` is how many shields the claim earned.
   */
  milestone?: {
    milestone: number;
    type: 'shield_earned' | 'achievement_unlocked';
    reward?: string;
    shieldsGranted?: number;
  } | null;
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

  getShields: async (): Promise<ShieldStatus> => {
    // Server shape: { freezes, milestone_shields, purchased, total, unlimited, cap, ... }
    const raw = await call<{
      total: number;
      cap: number;
      unlimited: boolean;
    }>('/api/streaks/shields');
    return {
      available: raw.total ?? 0,
      max: raw.cap ?? 3,
      used: 0,
      next_free_at: null,
      can_activate: raw.unlimited || (raw.total ?? 0) > 0,
      unlimited: raw.unlimited === true,
    };
  },

  claimStreak: (claimDate: string | null, timezone: string) =>
    call<ClaimResult>('/api/streaks/claim', {
      method: 'POST',
      body: { claimDate, timezone },
    }),

  activateFreeze: async (date: string, timezone: string): Promise<FreezeResult> => {
    // /api/streaks/freeze protects TODAY (planned absence); shielding a
    // specific missed day is /api/streaks/freeze/activate.
    const raw = await call<{
      success: boolean;
      shieldsRemaining: number | null;
      unlimited: boolean;
      message: string;
    }>('/api/streaks/freeze/activate', {
      method: 'POST',
      body: { date, timezone },
    });
    return {
      success: raw.success,
      date,
      freezes_remaining: raw.shieldsRemaining ?? Number.POSITIVE_INFINITY,
      message: raw.message,
    };
  },

  getHistory: (days = 30) =>
    call<{ entries: EngagementHistoryEntry[] }>('/api/streaks/engagement', {
      query: { history: 'true', days: String(days) },
    }).catch(() => ({ entries: [] as EngagementHistoryEntry[] })),
};

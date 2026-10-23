import { useAuthStore } from '@/stores/auth-store';

import type { CircleStreakStatus } from './types';

/**
 * Circle streak calls. Sends the Bearer token when the auth store has one and
 * otherwise relies on the Supabase session cookie (verifyMobileAuth accepts
 * both), so the circle screens work on a hard reload before checkAuth() has
 * repopulated the in-memory token.
 */
async function circleFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    tz = undefined;
  }
  const res = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tz ? { 'x-client-timezone': tz } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: { message?: string } };
  if (!res.ok || json.success === false) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

/** GET /api/mobile/circles/[id]/streak */
export function getCircleStreakStatus(circleId: string): Promise<CircleStreakStatus> {
  return circleFetch<CircleStreakStatus>(`/api/mobile/circles/${encodeURIComponent(circleId)}/streak`);
}

/** POST /api/mobile/circles/[id]/streak/save: cover a member for today. */
export function coverCircleMember(circleId: string, coveredUserId: string): Promise<unknown> {
  return circleFetch(`/api/mobile/circles/${encodeURIComponent(circleId)}/streak/save`, {
    method: 'POST',
    body: JSON.stringify({ coveredUserId }),
  });
}

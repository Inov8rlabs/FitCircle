import { clientTimezone } from '@/lib/streaks/auto-claim-events';
import type { VitalsGoalsUpdate, VitalsSummary } from '@/lib/types/vitals';
import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Vitals client — typed wrappers over the dashboard vitals routes
// (docs/VITALS_CLIENT_CONTRACT.md). Mirrors the nutrition-client authedFetch
// pattern: Bearer JWT from useAuthStore (falling back to the session cookie
// when the in-memory token isn't populated yet), `x-client-timezone` so the
// server anchors on the user's local day, standard envelope
// { success, data, error, meta } unwrapped to `data`. Clients are thin
// renderers — all goal/BMI/day math lives server-side.
// ---------------------------------------------------------------------------

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: Record<string, unknown> | null } | null;
  meta: unknown;
}

export class VitalsApiError extends Error {
  code: string;
  details: Record<string, unknown> | null;
  constructor(message: string, code: string, details: Record<string, unknown> | null) {
    super(message);
    this.name = 'VitalsApiError';
    this.code = code;
    this.details = details;
  }
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authedFetchEnvelope<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      'x-client-timezone': clientTimezone() ?? '',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? `Request failed (${res.status})`;
    throw new VitalsApiError(
      typeof msg === 'string' ? msg : 'Request failed',
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.details ?? null,
    );
  }
  return json;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const json = await authedFetchEnvelope<T>(path, init);
  return json.data as T;
}

export const vitalsClient = {
  /** GET /api/mobile/vitals/summary?days=N — `days` 1–90, default 7. */
  getSummary: (days = 7) =>
    authedFetch<VitalsSummary>(`/api/mobile/vitals/summary?days=${encodeURIComponent(days)}`),

  /**
   * PUT /api/mobile/vitals/goals — any subset; `null` clears a field.
   * Returns the refreshed 7-day summary.
   */
  updateGoals: (body: VitalsGoalsUpdate) =>
    authedFetch<VitalsSummary>('/api/mobile/vitals/goals', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

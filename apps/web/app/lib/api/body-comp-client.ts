import type {
  BodyCompCreate,
  BodyCompDraft,
  BodyCompImportRequest,
  BodyCompImportResult,
  BodyCompListResponse,
  BodyCompLog,
  BodyCompTrends,
  BodyCompUpdate,
  EntitlementsResponse,
} from '@/lib/types/body-composition';
import { useAuthStore } from '@/stores/auth-store';

// ---------------------------------------------------------------------------
// Body-composition client — typed wrappers over the frozen mobile body-comp
// routes (docs/BODY_COMP_BUILD_CONTRACT.md §2). Mirrors the nutrition-client
// authedFetch pattern: Bearer JWT from useAuthStore, standard envelope
// { success, data, error, meta } unwrapped to `data`. Clients are thin
// renderers — trend logic and derivations live server-side only.
// Body-comp data is PRIVATE-ONLY: never surface it in any social feature.
// ---------------------------------------------------------------------------

/** Below this overall confidence a scan draft falls back to prefilled manual entry (§2). */
export const BODY_COMP_LOW_CONFIDENCE_THRESHOLD = 0.6;

/** The photo-parse endpoint accepts 1–3 `image` parts per request (§2). */
export const BODY_COMP_SCAN_MAX_IMAGES = 3;

// --- envelope plumbing -----------------------------------------------------

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: Record<string, unknown> | null } | null;
  meta: unknown;
}

/**
 * Error that preserves the API envelope's `code` + `details` (plain Error loses
 * them). Lets callers act on e.g. PREMIUM_REQUIRED, PARSE_FAILED, RATE_LIMITED.
 */
export class BodyCompApiError extends Error {
  code: string;
  details: Record<string, unknown> | null;
  constructor(message: string, code: string, details: Record<string, unknown> | null) {
    super(message);
    this.name = 'BodyCompApiError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Bearer header when the auth store holds a token; otherwise rely on the
 * session cookie — requireMobileAuth accepts both, and surfaces outside the
 * (app) layout (e.g. the dashboard) may render before checkAuth populates
 * the in-memory token.
 */
function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json?.success === false) {
    const msg = json?.error?.message ?? `Request failed (${res.status})`;
    throw new BodyCompApiError(
      typeof msg === 'string' ? msg : 'Request failed',
      json?.error?.code ?? 'UNKNOWN',
      json?.error?.details ?? null,
    );
  }
  return json.data as T;
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  return unwrap<T>(res);
}

/** Multipart variant — do NOT set Content-Type (browser sets the boundary). */
async function authedFetchForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    credentials: 'include',
  });
  return unwrap<T>(res);
}

// --- client ----------------------------------------------------------------

export const bodyCompClient = {
  /** Tier + per-feature allowed map. Fetch after auth, cache, re-fetch on foreground. */
  getEntitlements: () => authedFetch<EntitlementsResponse>('/api/mobile/entitlements'),

  /**
   * Create a log (also commits confirmed scan drafts with source 'photo_scan').
   * Upsert semantics on the (user, measuredAt, source) unique key.
   */
  create: (input: BodyCompCreate) =>
    authedFetch<BodyCompLog>('/api/mobile/body-comp', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** Newest-first page of logs; cursor via `before` = previous page's nextBefore. */
  list: (opts?: { start?: string; end?: string; limit?: number; before?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.start) qs.set('start', opts.start);
    if (opts?.end) qs.set('end', opts.end);
    if (opts?.limit != null) qs.set('limit', String(opts.limit));
    if (opts?.before) qs.set('before', opts.before);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return authedFetch<BodyCompListResponse>(`/api/mobile/body-comp${suffix}`);
  },

  getLatest: () => authedFetch<BodyCompLog | null>('/api/mobile/body-comp/latest'),

  update: (id: string, patch: BodyCompUpdate) =>
    authedFetch<BodyCompLog>(`/api/mobile/body-comp/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  delete: (id: string) =>
    authedFetch<{ deleted: true }>(`/api/mobile/body-comp/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  /** Platform import (used by mobile; exposed for completeness/tests). */
  import: (req: BodyCompImportRequest) =>
    authedFetch<BodyCompImportResult>('/api/mobile/body-comp/import', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  /** Server-computed trends (feature `body_comp_trends`) — render verbatim, never re-derive. */
  getTrends: (lookbackDays?: number) => {
    const suffix = lookbackDays != null ? `?lookbackDays=${lookbackDays}` : '';
    return authedFetch<BodyCompTrends>(`/api/mobile/body-comp/trends${suffix}`);
  },

  /**
   * Scan sheet photos → draft (feature `body_comp_photo_scan`). Draft only; the
   * user confirms and the client then commits via create() with source 'photo_scan'.
   * Images beyond the cap are dropped here so no call site can overshoot the server.
   */
  photoParse: (images: File[]) => {
    const form = new FormData();
    for (const img of images.slice(0, BODY_COMP_SCAN_MAX_IMAGES)) form.append('image', img);
    return authedFetchForm<BodyCompDraft>('/api/mobile/body-comp/photo-parse', form);
  },
};

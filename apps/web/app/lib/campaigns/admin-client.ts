/**
 * Typed client for the campaigns admin API (CAMPAIGNS_SPEC §8). Browser-side:
 * the cookie session authenticates; the in-memory Bearer token is sent too when
 * present (same pattern as the other web API clients). Accepts both the
 * standard `{ success, data, error }` envelope and bare JSON bodies.
 */

import { useAuthStore } from '@/stores/auth-store';

import type { AdminCampaign, ArtSlot, CampaignAppStore, CampaignInput } from './types';

export class CampaignApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown> | null;
  constructor(message: string, status: number, code: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'CampaignApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const isVersionConflict = (e: unknown) => e instanceof CampaignApiError && e.code === 'VERSION_CONFLICT';
export const isAppStoreNotConnected = (e: unknown) => e instanceof CampaignApiError && e.code === 'APP_STORE_NOT_CONNECTED';

function authHeaders(): Record<string, string> {
  try {
    const token = useAuthStore.getState().token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function timezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      'x-client-timezone': timezone(),
      ...(init.headers ?? {}),
    },
    credentials: 'include',
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const enveloped = json !== null && typeof json === 'object' && 'success' in json;
  if (!res.ok || (enveloped && json.success === false)) {
    const err = (json?.error ?? null) as { code?: string; message?: string; details?: Record<string, unknown> } | string | null;
    const code = typeof err === 'object' && err?.code ? err.code : (json?.code as string | undefined) ?? `HTTP_${res.status}`;
    const message =
      typeof err === 'string' ? err : err?.message ?? (json?.message as string | undefined) ?? `Request failed (${res.status})`;
    throw new CampaignApiError(message, res.status, code, typeof err === 'object' ? err?.details ?? null : null);
  }
  return (enveloped ? json.data : json) as T;
}

const base = '/api/admin/campaigns';
const idPath = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** GET /{id}/app-store (sync/submit may return this or the updated campaign). */
export interface AppStoreStatus {
  connected?: boolean;
  eventId?: string | null;
  state?: string | null;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  issues?: string[];
  appStore?: CampaignAppStore;
  [key: string]: unknown;
}

export const campaignsAdmin = {
  me: () => apiRequest<{ isAdmin: boolean }>('/api/admin/me'),

  list: async () => (await apiRequest<{ campaigns: AdminCampaign[] }>(base)).campaigns ?? [],
  get: (id: string) => apiRequest<AdminCampaign | { campaign: AdminCampaign }>(idPath(id)).then(unwrapCampaign),
  create: (input: CampaignInput) =>
    apiRequest<AdminCampaign | { campaign: AdminCampaign }>(base, { method: 'POST', body: JSON.stringify(input) }).then(unwrapCampaign),
  update: (id: string, input: Partial<CampaignInput>, version: number) =>
    apiRequest<AdminCampaign | { campaign: AdminCampaign }>(idPath(id), {
      method: 'PATCH',
      body: JSON.stringify({ ...input, version }),
    }).then(unwrapCampaign),
  archive: (id: string) => apiRequest<unknown>(idPath(id), { method: 'DELETE' }),

  publish: (id: string) => apiRequest<AdminCampaign | { campaign: AdminCampaign }>(`${idPath(id)}/publish`, { method: 'POST' }).then(unwrapCampaign),
  unpublish: (id: string) =>
    apiRequest<AdminCampaign | { campaign: AdminCampaign }>(`${idPath(id)}/unpublish`, { method: 'POST' }).then(unwrapCampaign),

  uploadArt: (id: string, slot: ArtSlot, file: Blob, generated: boolean) => {
    const form = new FormData();
    form.set('slot', slot);
    form.set('file', file, `${slot}.png`);
    form.set('generated', generated ? 'true' : 'false');
    return apiRequest<AdminCampaign | { campaign: AdminCampaign }>(`${idPath(id)}/art`, { method: 'POST', body: form }).then(unwrapCampaign);
  },

  preview: (id: string, body: { onMyDevices: boolean; asOf?: string | null }) =>
    apiRequest<unknown>(`${idPath(id)}/preview`, { method: 'POST', body: JSON.stringify(body) }),

  testPush: (id: string, key: string) => apiRequest<unknown>(`${idPath(id)}/test-push`, { method: 'POST', body: JSON.stringify({ key }) }),
  testEmail: (id: string, key: string) => apiRequest<unknown>(`${idPath(id)}/test-email`, { method: 'POST', body: JSON.stringify({ key }) }),

  appStoreStatus: (id: string) => apiRequest<AppStoreStatus>(`${idPath(id)}/app-store`),
  appStoreSync: (id: string) => apiRequest<AppStoreStatus>(`${idPath(id)}/app-store/sync`, { method: 'POST' }),
  appStoreSubmit: (id: string) => apiRequest<AppStoreStatus>(`${idPath(id)}/app-store/submit`, { method: 'POST' }),
};

/** Some routes may wrap the campaign (`{ campaign }`); accept either. Returns null if the body carries none. */
function unwrapCampaign(v: AdminCampaign | { campaign: AdminCampaign } | null | undefined): AdminCampaign {
  if (v && typeof v === 'object' && 'campaign' in v && v.campaign) return v.campaign;
  return v as AdminCampaign;
}

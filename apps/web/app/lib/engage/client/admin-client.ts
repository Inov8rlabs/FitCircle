/**
 * Typed client for the Engage admin API (ENGAGE_SPEC §11). Browser-side;
 * cookie session (+ Bearer when the auth store has one). Tolerates both the
 * standard envelope and bare bodies (shared `apiRequest`).
 */

import { CampaignApiError, apiRequest } from '@/lib/campaigns/admin-client';
import { useAuthStore } from '@/stores/auth-store';

import type {
  EngageAsset,
  EngageChannel,
  EngageMessage,
  EngagePlatform,
  EngageSegment,
  FilterCondition,
  MessageInput,
  MessageStats,
  MessageStatus,
} from '../types';

import type { ProcessedImage } from './asset-pipeline';

export { CampaignApiError as EngageApiError };

const A = '/api/admin/engage';
const enc = encodeURIComponent;

function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function unwrap<T>(v: unknown, key: string): T {
  if (v && typeof v === 'object' && key in (v as Record<string, unknown>)) return (v as Record<string, T>)[key];
  return v as T;
}

export interface AssetUsage {
  messageId?: string;
  campaignId?: string;
  name: string;
  status?: string;
}

export interface UploadResult {
  asset: EngageAsset;
  deduped: boolean;
}

export interface Estimate {
  count: number;
  approximate: boolean;
  byPlatform?: Partial<Record<EngagePlatform, number>>;
}

export interface OverviewData {
  live: Array<Pick<EngageMessage, 'id' | 'name' | 'channel' | 'status' | 'placement' | 'layout' | 'startsAt' | 'endsAt' | 'platforms'>>;
  upcoming: Array<Pick<EngageMessage, 'id' | 'name' | 'channel' | 'status' | 'placement' | 'layout' | 'startsAt' | 'endsAt' | 'platforms'>>;
  totals: { impressions: number; clicks: number; conversions: number; pushSent?: number; emailSent?: number };
  daily?: Array<{ date: string; impressions: number; clicks: number; conversions: number }>;
  top?: Array<{ id: string; name: string; channel: EngageChannel; impressions: number; clicks: number; ctr: number | null; conversions: number }>;
}

/** List rows may carry light stats for sparklines. */
export type MessageListItem = EngageMessage & {
  stats?: { impressions: number; clicks: number; ctr: number | null; conversions: number; daily?: number[] };
};

function authHeader(): Record<string, string> {
  try {
    const t = useAuthStore.getState().token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

/** Multipart upload with progress (fetch can't report upload progress). */
function uploadWithProgress<T>(url: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    for (const [k, v] of Object.entries(authHeader())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new CampaignApiError('Network error', 0, 'NETWORK'));
    xhr.onload = () => {
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // non-JSON
      }
      const enveloped = json !== null && 'success' in json;
      if (xhr.status >= 400 || (enveloped && json?.success === false)) {
        const err = (json?.error ?? null) as { code?: string; message?: string; details?: Record<string, unknown> } | null;
        reject(new CampaignApiError(err?.message ?? `Upload failed (${xhr.status})`, xhr.status, err?.code ?? `HTTP_${xhr.status}`, err?.details ?? null));
        return;
      }
      resolve(((enveloped ? json?.data : json) ?? {}) as T);
    };
    xhr.send(form);
  });
}

export const engageAdmin = {
  // ---------------------------------------------------------------- assets
  listAssets: async (params: { q?: string; tag?: string; cursor?: string } = {}) => {
    const r = await apiRequest<{ assets: EngageAsset[]; nextCursor?: string | null } | EngageAsset[]>(`${A}/assets${qs(params)}`);
    return Array.isArray(r) ? { assets: r, nextCursor: null } : { assets: r.assets ?? [], nextCursor: r.nextCursor ?? null };
  },
  uploadAsset: async (img: ProcessedImage, onProgress?: (pct: number) => void, extra: { tags?: string[] } = {}): Promise<UploadResult> => {
    const form = new FormData();
    form.set('file', img.file, img.file.name);
    img.variants.forEach((v) => form.append('variants[]', v.blob, `${img.sha256}@${v.width}.webp`));
    form.set(
      'metadata',
      JSON.stringify({
        sha256: img.sha256,
        name: img.name,
        mime: img.mime,
        width: img.width,
        height: img.height,
        bytes: img.bytes,
        dominantColor: img.dominantColor,
        variants: img.variants.map((v) => ({ width: v.width, height: v.height, format: 'webp' })),
        tags: extra.tags ?? [],
      })
    );
    const r = await uploadWithProgress<{ asset?: EngageAsset; deduped?: boolean } & Partial<EngageAsset>>(`${A}/assets`, form, onProgress);
    const asset = (r.asset ?? r) as EngageAsset;
    return { asset, deduped: Boolean(r.deduped) };
  },
  updateAsset: (id: string, patch: { name?: string; tags?: string[]; alt?: string | null }) =>
    apiRequest<EngageAsset | { asset: EngageAsset }>(`${A}/assets/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => unwrap<EngageAsset>(r, 'asset')),
  archiveAsset: (id: string) => apiRequest<unknown>(`${A}/assets/${enc(id)}`, { method: 'DELETE' }),
  /** GET /assets/{id} → asset + where it's used. */
  assetUsage: (id: string) =>
    apiRequest<{ usage?: AssetUsage[]; asset?: { usage?: AssetUsage[] } }>(`${A}/assets/${enc(id)}`).then((r) => r.usage ?? r.asset?.usage ?? []),

  // ---------------------------------------------------------------- messages
  listMessages: async (params: { channel?: EngageChannel; status?: MessageStatus; campaignId?: string } = {}) => {
    const r = await apiRequest<{ messages: MessageListItem[] } | MessageListItem[]>(`${A}/messages${qs(params)}`);
    return Array.isArray(r) ? r : r.messages ?? [];
  },
  getMessage: (id: string) => apiRequest<EngageMessage | { message: EngageMessage }>(`${A}/messages/${enc(id)}`).then((r) => unwrap<EngageMessage>(r, 'message')),
  createMessage: (input: MessageInput) =>
    apiRequest<EngageMessage | { message: EngageMessage }>(`${A}/messages`, { method: 'POST', body: JSON.stringify(input) }).then((r) => unwrap<EngageMessage>(r, 'message')),
  updateMessage: (id: string, input: Partial<MessageInput>, version: number) =>
    apiRequest<EngageMessage | { message: EngageMessage }>(`${A}/messages/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ ...input, version }) }).then((r) =>
      unwrap<EngageMessage>(r, 'message')
    ),
  archiveMessage: (id: string) => apiRequest<unknown>(`${A}/messages/${enc(id)}`, { method: 'DELETE' }),
  action: (id: string, act: 'launch' | 'pause' | 'resume' | 'duplicate') =>
    apiRequest<EngageMessage | { message: EngageMessage }>(`${A}/messages/${enc(id)}/${act}`, { method: 'POST' }).then((r) => unwrap<EngageMessage>(r, 'message')),
  test: (id: string, body: { variantId?: string; platform?: EngagePlatform } = {}) =>
    apiRequest<unknown>(`${A}/messages/${enc(id)}/test`, { method: 'POST', body: JSON.stringify(body) }),
  preview: (id: string, onMyDevices: boolean) =>
    apiRequest<unknown>(`${A}/messages/${enc(id)}/preview`, { method: 'POST', body: JSON.stringify({ onMyDevices }) }),
  stats: (id: string, params: { from?: string; to?: string; platform?: EngagePlatform | 'all' } = {}) =>
    apiRequest<MessageStats>(`${A}/messages/${enc(id)}/stats${qs({ ...params, platform: params.platform === 'all' ? undefined : params.platform })}`),

  // ---------------------------------------------------------------- segments
  listSegments: async () => {
    const r = await apiRequest<{ segments: EngageSegment[] } | EngageSegment[]>(`${A}/segments`);
    return Array.isArray(r) ? r : r.segments ?? [];
  },
  getSegment: (id: string) => apiRequest<EngageSegment | { segment: EngageSegment }>(`${A}/segments/${enc(id)}`).then((r) => unwrap<EngageSegment>(r, 'segment')),
  createSegment: (s: { name: string; description: string; filters: FilterCondition[] }) =>
    apiRequest<EngageSegment | { segment: EngageSegment }>(`${A}/segments`, { method: 'POST', body: JSON.stringify(s) }).then((r) => unwrap<EngageSegment>(r, 'segment')),
  updateSegment: (id: string, s: Partial<{ name: string; description: string; filters: FilterCondition[] }>) =>
    apiRequest<EngageSegment | { segment: EngageSegment }>(`${A}/segments/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(s) }).then((r) => unwrap<EngageSegment>(r, 'segment')),
  deleteSegment: (id: string) => apiRequest<unknown>(`${A}/segments/${enc(id)}`, { method: 'DELETE' }),
  estimate: async (body: { filters: FilterCondition[]; segmentId?: string | null; platforms?: EngagePlatform[] }): Promise<Estimate> => {
    const r = await apiRequest<{ count?: number; estimatedCount?: number; approximate?: boolean; byPlatform?: Estimate['byPlatform'] }>(`${A}/segments/estimate`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { count: r.count ?? r.estimatedCount ?? 0, approximate: Boolean(r.approximate), byPlatform: r.byPlatform };
  },

  // ---------------------------------------------------------------- overview
  overview: async (): Promise<OverviewData> => {
    const r = await apiRequest<
      Partial<OverviewData> & {
        last7Days?: OverviewData['totals'];
        topMessages?: Array<{ messageId?: string; id?: string; name: string; channel: EngageChannel; clicks: number; impressions?: number; ctr?: number | null; conversions?: number }>;
      }
    >(`${A}/overview`);
    return {
      live: r.live ?? [],
      upcoming: r.upcoming ?? [],
      totals: r.totals ?? r.last7Days ?? { impressions: 0, clicks: 0, conversions: 0 },
      daily: r.daily,
      top:
        r.top ??
        (r.topMessages ?? []).map((t) => ({ id: t.id ?? t.messageId ?? '', name: t.name, channel: t.channel, clicks: t.clicks, impressions: t.impressions ?? 0, ctr: t.ctr ?? null, conversions: t.conversions ?? 0 })),
    };
  },
};

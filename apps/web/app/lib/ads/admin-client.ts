/**
 * Browser client for /api/admin/ads/* (the console UI talks only to these
 * routes — never to Supabase — so it can later move to a separate admin app).
 */
import { apiRequest } from '@/lib/campaigns/admin-client';

import type { AdChangeLogEntry, AdChangeResult, AdChannel, AdsOverview, AdsTimeseries, CampaignDetail, ChannelSyncStatus, GroupBy } from './types';

const qs = (p: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) s.set(k, v);
  const str = s.toString();
  return str ? `?${str}` : '';
};

export interface ChangeInput {
  channel: AdChannel;
  level: 'campaign' | 'ad_group' | 'keyword' | 'ad';
  externalId: string;
  field: 'bid' | 'daily_budget' | 'status';
  value: number | string;
  dryRun?: boolean;
  force?: boolean;
  expectedOldValue?: number | string | null;
}

export const adsAdmin = {
  overview: (start: string, end: string, groupBy: GroupBy) => apiRequest<AdsOverview>(`/api/admin/ads/overview${qs({ start, end, groupBy })}`),
  timeseries: (start: string, end: string, channel?: string | null, campaign?: string | null) =>
    apiRequest<AdsTimeseries>(`/api/admin/ads/timeseries${qs({ start, end, channel, campaign })}`),
  campaign: (channel: string, externalId: string, start: string, end: string) =>
    apiRequest<CampaignDetail>(`/api/admin/ads/campaigns/${encodeURIComponent(channel)}/${encodeURIComponent(externalId)}${qs({ start, end })}`),
  change: (input: ChangeInput) => apiRequest<AdChangeResult>('/api/admin/ads/changes', { method: 'POST', body: JSON.stringify(input) }),
  changes: (limit = 200) => apiRequest<{ changes: AdChangeLogEntry[] }>(`/api/admin/ads/changes${qs({ limit: String(limit) })}`).then((r) => r.changes ?? []),
  syncNow: (channel?: AdChannel) =>
    apiRequest<{ results: unknown[]; status: ChannelSyncStatus[] }>('/api/admin/ads/sync', { method: 'POST', body: JSON.stringify(channel ? { channel } : {}) }),
};

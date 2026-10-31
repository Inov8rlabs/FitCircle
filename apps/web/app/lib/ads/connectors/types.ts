/** One ad network (docs/ADS_CONSOLE_SPEC.md §2). */
import type { AdChangeRequest, AdChannel, AdConversionDailyInput, AdDailyMetricInput, AdEntityInput, AdEntityRef, ConnectorChangeResult } from '../types';

export interface AdsConnector {
  channel: AdChannel;
  isConfigured(): boolean;
  /** Entities (campaign, ad_group, keyword, ad/creative) with setup fields. */
  fetchEntities(): Promise<AdEntityInput[]>;
  /** Daily delivery rows, one per (entity, date), for [start, end] inclusive. */
  fetchDailyMetrics(start: string, end: string): Promise<AdDailyMetricInput[]>;
  /** Re-read one entity from the network (freshness check before a write). */
  readEntity(ref: AdEntityRef): Promise<AdEntityInput | null>;
  /** Apply one change. Must re-read the entity afterwards and return the new value. */
  applyChange(change: AdChangeRequest): Promise<ConnectorChangeResult>;
  /** Network-reported conversions by conversion action, campaign level (Google Ads only for now). */
  fetchConversions?(start: string, end: string): Promise<AdConversionDailyInput[]>;
  /** Network's own totals for [start, end] (read-only; used by /api/admin/ads/verify). */
  fetchTotals?(start: string, end: string): Promise<NetworkTotals>;
  /** The time zone the network reports days in (Apple: org time zone), when known. */
  reportTimeZone?(): Promise<string | null>;
}

export interface DeliveryFieldTotals {
  spend: number;
  currency: string | null;
  impressions: number;
  taps: number;
  installs: number;
}

export interface NetworkTotals {
  totals: DeliveryFieldTotals;
  campaigns: Array<{ campaignExternalId: string; name: string | null; fields: DeliveryFieldTotals }>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
    public readonly body: string | null = null
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

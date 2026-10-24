/**
 * Ads Console shared types (docs/ADS_CONSOLE_SPEC.md). Used by the connectors,
 * the services behind /api/admin/ads/*, and the admin UI (types only — the UI
 * talks to the API, never to Supabase).
 */

export type AdChannel = 'apple_ads' | 'meta' | 'google_ads';
/** Attribution channels also include outcome-only buckets. */
export type AttributionChannel = AdChannel | 'organic' | 'unknown';
export type AdPlatform = 'ios' | 'android' | 'web' | 'all';
export type AdLevel = 'campaign' | 'ad_group' | 'keyword' | 'ad' | 'creative';
export type AdChangeField = 'bid' | 'daily_budget' | 'status';
export type GroupBy = 'channel' | 'platform' | 'campaign' | 'ad_group' | 'keyword' | 'ad';

export const AD_CHANNELS: AdChannel[] = ['apple_ads', 'meta', 'google_ads'];
export const GROUP_BYS: GroupBy[] = ['channel', 'platform', 'campaign', 'ad_group', 'keyword', 'ad'];

export const CHANNEL_LABEL: Record<AttributionChannel, string> = {
  apple_ads: 'Apple Ads',
  meta: 'Meta',
  google_ads: 'Google Ads',
  organic: 'Organic',
  unknown: 'Unknown',
};

export interface AdCreative {
  productPageId?: string | null;
  productPageName?: string | null;
  creativeId?: string | null;
  creativeType?: string | null;
  thumbnailUrl?: string | null;
  headline?: string | null;
  body?: string | null;
}

/** What a connector returns for one remote object (maps 1:1 to ad_entities). */
export interface AdEntityInput {
  channel: AdChannel;
  platform: AdPlatform;
  level: AdLevel;
  externalId: string;
  parentExternalId: string | null;
  campaignExternalId: string | null;
  name: string | null;
  status: string | null;
  servingStatus: string | null;
  bidStrategy: string | null;
  bidAmount: number | null;
  bidCurrency: string | null;
  dailyBudget: number | null;
  totalBudget: number | null;
  matchType: string | null;
  countries: string[] | null;
  startAt: string | null;
  endAt: string | null;
  creative: AdCreative | null;
  raw: unknown;
}

/** One delivery row per (entity, date). */
export interface AdDailyMetricInput {
  channel: AdChannel;
  level: AdLevel;
  externalId: string;
  campaignExternalId: string | null;
  date: string; // YYYY-MM-DD in the network's report time zone
  spend: number;
  currency: string;
  impressions: number;
  taps: number;
  installs: number;
  newDownloads: number;
  redownloads: number;
}

export interface AdEntityRef {
  channel: AdChannel;
  level: AdLevel;
  externalId: string;
  parentExternalId: string | null;
  campaignExternalId: string | null;
}

export interface AdChangeRequest extends AdEntityRef {
  field: AdChangeField;
  /** Number for bid / daily_budget (major units, e.g. USD); string for status. */
  value: number | string;
  currency: string;
}

/** Connector result for one applied change: the value read back from the network. */
export interface ConnectorChangeResult {
  confirmedValue: number | string | null;
  entity: AdEntityInput | null;
}

/** Row shape of ad_entities as stored. */
export interface AdEntityRow {
  id?: string;
  channel: AdChannel;
  platform: AdPlatform;
  level: AdLevel;
  external_id: string;
  parent_external_id: string | null;
  campaign_external_id: string | null;
  name: string | null;
  status: string | null;
  serving_status: string | null;
  bid_strategy: string | null;
  bid_amount: number | string | null;
  bid_currency: string | null;
  daily_budget: number | string | null;
  total_budget: number | string | null;
  match_type: string | null;
  countries: string[] | null;
  start_at: string | null;
  end_at: string | null;
  creative: AdCreative | null;
  raw?: unknown;
  synced_at: string;
}

export interface AdMetricRow {
  channel: AdChannel;
  level: AdLevel;
  external_id: string;
  campaign_external_id: string | null;
  date: string;
  spend: number | string;
  currency: string;
  impressions: number;
  taps: number;
  installs: number;
  new_downloads?: number;
  redownloads?: number;
}

export interface AttributionRow {
  user_id: string;
  channel: AttributionChannel;
  platform: 'ios' | 'android' | 'web' | null;
  source: string;
  campaign_external_id: string | null;
  ad_group_external_id: string | null;
  keyword_external_id: string | null;
  ad_external_id: string | null;
  click_at: string | null;
  country: string | null;
  is_test: boolean;
  raw: unknown;
  reported_at?: string;
}

/** A computed slice (one table row, or totals). Ratios are null when the denominator is 0. */
export interface AdsMetrics {
  spend: number;
  currency: string;
  /** True when some spend in this slice was not USD (v1 sums it as-is). */
  mixedCurrency: boolean;
  impressions: number;
  taps: number;
  installs: number;
  users: number;
  activated: number;
  trials: number;
  payers: number;
  revenueD7: number;
  revenueD30: number;
  revenueToDate: number;
  cpt: number | null;
  ttr: number | null;
  cpi: number | null;
  costPerUser: number | null;
  costPerActivated: number | null;
  costPerPayer: number | null;
  roasD7: number | null;
  roasD30: number | null;
  roasToDate: number | null;
  installToUser: number | null;
  userToActivated: number | null;
  userToPayer: number | null;
  /** Cohort windows that have not closed yet (UI greys these). */
  incomplete: { activated: boolean; d7: boolean; d30: boolean };
}

export interface FieldEditability {
  editable: boolean;
  /** Why not (automated bidding, read-only connector, level has no such field…). */
  reason: string | null;
}

export interface Editability {
  bid: FieldEditability;
  dailyBudget: FieldEditability;
  status: FieldEditability;
}

export interface AdsRow {
  key: string;
  groupBy: GroupBy;
  label: string;
  sublabel: string | null;
  channel: AttributionChannel | null;
  platform: string | null;
  level: AdLevel | null;
  externalId: string | null;
  campaignExternalId: string | null;
  entity: AdEntityView | null;
  metrics: AdsMetrics;
}

export interface AdEntityView {
  channel: AdChannel;
  platform: AdPlatform;
  level: AdLevel;
  externalId: string;
  parentExternalId: string | null;
  campaignExternalId: string | null;
  name: string | null;
  status: string | null;
  servingStatus: string | null;
  bidStrategy: string | null;
  bidAmount: number | null;
  bidCurrency: string | null;
  dailyBudget: number | null;
  totalBudget: number | null;
  matchType: string | null;
  countries: string[] | null;
  startAt: string | null;
  endAt: string | null;
  creative: AdCreative | null;
  syncedAt: string;
  extra: Record<string, unknown>;
}

export interface ChannelSyncStatus {
  channel: AdChannel;
  configured: boolean;
  writeEnabled: boolean;
  finishedAt: string | null;
  startedAt: string | null;
  ok: boolean | null;
  error: string | null;
}

export interface AdsOverview {
  range: { start: string; end: string; timeZone: string };
  groupBy: GroupBy;
  rows: AdsRow[];
  totals: AdsRow;
  lastSync: ChannelSyncStatus[];
  testUsers: number;
  targets: AdsTargets;
}

export interface AdsTargets {
  costPerPayerMax: number;
  roasD7Min: number;
  roasD30Min: number;
  roas12mMin: number;
}

export interface CampaignDetailEntity extends AdEntityView {
  editability: Editability;
  metrics: AdsMetrics;
  todaySpend: number;
}

export interface CampaignDetail {
  range: { start: string; end: string; timeZone: string };
  campaign: CampaignDetailEntity;
  adGroups: CampaignDetailEntity[];
  keywords: CampaignDetailEntity[];
  ads: CampaignDetailEntity[];
  /** Attributed users of this campaign whose keyword/ad group we can't place. */
  unplaced: { adGroup: AdsMetrics | null; keyword: AdsMetrics | null };
  sync: ChannelSyncStatus;
  targets: AdsTargets;
}

export interface TimeseriesPoint {
  date: string;
  spend: number;
  installs: number;
  users: number;
  activated: number;
  payers: number;
  revenue: number;
  /** Cumulative to-date ROAS of the range so far (null while spend is 0). */
  cumulativeRoas: number | null;
}

export interface AdsTimeseries {
  range: { start: string; end: string; timeZone: string };
  points: TimeseriesPoint[];
  targets: AdsTargets;
}

export type GuardrailRule =
  | 'entity_exists'
  | 'writable'
  | 'field_supported'
  | 'manual_bidding'
  | 'valid_value'
  | 'no_change'
  | 'bounds'
  | 'step_limit'
  | 'fresh';

export interface GuardrailCheck {
  rule: GuardrailRule;
  ok: boolean;
  message: string;
}

export type ChangeOutcome = 'applied' | 'rejected' | 'failed' | 'dry_run';

export interface AdChangeResult {
  ok: boolean;
  outcome: ChangeOutcome;
  /** First failing rule (or 'stale' / 'apply_failed'). */
  code: string | null;
  message: string | null;
  checks: GuardrailCheck[];
  oldValue: number | string | null;
  requestedValue: number | string;
  newValue: number | string | null;
  pctChange: number | null;
  todaySpend: number;
  forced: boolean;
  logId: string | null;
}

export interface AdChangeLogEntry {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  channel: string;
  level: string;
  externalId: string;
  campaignExternalId: string | null;
  entityName: string | null;
  field: AdChangeField;
  oldValue: string | null;
  newValue: string | null;
  requestedValue: string | null;
  outcome: ChangeOutcome;
  forced: boolean;
  error: string | null;
  createdAt: string;
}

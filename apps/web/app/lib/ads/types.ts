/**
 * Ads Console shared types (docs/ADS_CONSOLE_SPEC.md). Used by the connectors,
 * the services behind /api/admin/ads/*, and the admin UI (types only — the UI
 * talks to the API, never to Supabase).
 */
import type { TestUserReason } from './test-users';

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
  /** Sign-ups left out of the counts (= excludedUsers.total; kept for older clients). */
  testUsers: number;
  excludedUsers: ExcludedUsers;
  targets: AdsTargets;
  /** Reconciliation / freshness checks computed on read (lib/ads/data-health.ts). */
  dataHealth: DataHealth;
  /** Metric key (AdsMetrics field) → one-line definition for UI tooltips (docs/ADS_METRICS_METHODOLOGY.md). */
  definitions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Data health (overview.dataHealth) and live verification (/api/admin/ads/verify)
// ---------------------------------------------------------------------------

export type HealthStatus = 'ok' | 'warn' | 'error';

/** One line of the "Data health" panel. */
export interface HealthCheck {
  key: 'sync' | 'spend_reconciliation' | 'attribution' | 'revenue' | 'currency';
  label: string;
  status: HealthStatus;
  /** Human-readable reasons (first one is the headline). */
  reasons: string[];
}

export interface SyncHealth {
  channel: AdChannel;
  configured: boolean;
  /** finished_at of the latest ok run (null = never succeeded). */
  lastSuccessAt: string | null;
  /** Minutes since lastSuccessAt (null = never). */
  ageMinutes: number | null;
  /** True when the latest finished run failed. */
  lastRunFailed: boolean;
  lastError: string | null;
  status: HealthStatus;
}

export interface SpendMismatch {
  channel: AdChannel;
  campaignExternalId: string;
  date: string;
  campaignSpend: number;
  adGroupSpend: number;
  /** campaignSpend − adGroupSpend. */
  diff: number;
}

export interface SpendReconciliation {
  status: HealthStatus;
  /** (campaign, day) pairs with delivery checked. */
  campaignDays: number;
  mismatchedCampaignDays: number;
  /** Worst first, at most 20. */
  mismatches: SpendMismatch[];
  /** Σ |campaign − ad group| over mismatched pairs. */
  totalAbsDiff: number;
  /** Apple Ads: Σ keyword spend ÷ Σ campaign spend × 100 (0–100, 1 decimal; the rest is Search Match / no keyword). Null with no Apple spend. */
  keywordCoveragePct: number | null;
  keywordSpend: number;
  appleCampaignSpend: number;
}

export interface AttributionCoverage {
  status: HealthStatus;
  /** Σ network-reported installs on paid channels in the range. */
  paidInstalls: number;
  /** Sign-ups in the cohort attributed to a paid channel (test users excluded). */
  attributedPaidUsers: number;
  /** attributedPaidUsers ÷ paidInstalls × 100 (0–100+, 1 decimal; null with 0 installs). */
  coveragePct: number | null;
  /** attributedPaidUsers by user_attribution.source (apple_search_ads, revenuecat, …). */
  bySource: Record<string, number>;
  explanation: string;
}

export interface RevenueHealth {
  status: HealthStatus;
  /** PRODUCTION revenue-bearing events (purchases, renewals, refunds) after de-duplication. */
  revenueEvents: number;
  /** Events without takehome_percentage (deprecated by RevenueCat). */
  missingTakehome: number;
  /** Events with neither tax/commission percentages nor takehome → store fallback rate used. */
  fallbackRateUsed: number;
  /** Events with no usable USD price (counted as $0). */
  missingPrice: number;
  /** Family Sharing grants (no revenue; the organiser's purchase counts once). */
  familyShareExcluded: number;
  /** Duplicate deliveries of the same store transaction dropped. */
  duplicatesDropped: number;
}

export interface CurrencyHealth {
  status: HealthStatus;
  mixedCurrency: boolean;
  /** Currencies with non-zero spend in the range. */
  currencies: string[];
}

export interface DataHealth {
  /** Worst of the checks. */
  status: HealthStatus;
  generatedAt: string;
  checks: HealthCheck[];
  sync: SyncHealth[];
  spend: SpendReconciliation;
  attribution: AttributionCoverage;
  revenue: RevenueHealth;
  currency: CurrencyHealth;
}

export type VerifyField = 'spend' | 'impressions' | 'taps' | 'installs';

export interface VerifyFieldDiff {
  field: VerifyField;
  /** Live from the network (grand totals for the range). */
  network: number;
  /** Σ ad_metrics_daily campaign-level rows for the range. */
  stored: number;
  /** stored − network. */
  diff: number;
  /** diff ÷ network × 100 (percent, 2 decimals; null when network is 0). */
  diffPct: number | null;
  ok: boolean;
}

export interface VerifyCampaignDiff {
  campaignExternalId: string;
  name: string | null;
  fields: VerifyFieldDiff[];
}

export interface AdsVerifyResult {
  channel: AdChannel;
  range: { start: string; end: string; timeZone: string };
  fetchedAt: string;
  /** All four fields match within tolerance. */
  ok: boolean;
  totals: VerifyFieldDiff[];
  /** Campaigns where any field differs (empty when everything matches). */
  campaigns: VerifyCampaignDiff[];
  /** The network account's report time zone (Apple org time zone), when known. */
  networkTimeZone: string | null;
  /** False when the network's time zone differs from the console's report time zone. */
  timeZoneMatches: boolean | null;
  lastSyncAt: string | null;
  notes: string[];
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
  /** 'external' = detected by sync (changed in the network's own UI); no actor is known. */
  source: 'console' | 'external';
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

/** Internal / review / test-lab / Play-tester sign-ups in the range (lib/ads/test-users.ts). */
export interface ExcludedUsers {
  total: number;
  byReason: Partial<Record<TestUserReason, number>>;
  /** True when ?includeTest=1 counted them anyway. */
  included: boolean;
}

// ---------------------------------------------------------------------------
// Virality (GET /api/admin/ads/virality, docs/ADS_METRICS_METHODOLOGY.md §8)
// ---------------------------------------------------------------------------

/** Where a cohort user stood with circles in their first 7 days (mutually exclusive, first match wins). */
export interface ViralityCircleStates {
  /** In a non-public circle with ≥ 1 other real active member (= sociallyActivated). */
  social: number;
  /** In a non-public circle, but alone (no other real active member in the window). */
  soloPrivate: number;
  /** Only in public circles (e.g. the public demo circle). */
  publicOnly: number;
  /** In no circle during the window. */
  none: number;
}

/** Virality of one slice of the sign-up cohort. Ratios are null when the denominator is 0. */
export interface ViralityMetrics {
  /** Cohort users in the slice (test users excluded unless includeTest). */
  users: number;
  /** Users who invited by any DB-visible route within 7 days of sign-up. */
  invited: number;
  invitedRate: number | null;
  /** Users per route (a user can take several routes). */
  invitedBy: { sentInvite: number; referralJoin: number; circleJoin: number };
  /** Users who sent ≥ 1 email/SMS invite (referral_invites) within 7 days. */
  inviters: number;
  /** Email/SMS invites sent within 7 days of the inviter's sign-up (status ≠ failed). */
  invitesSent: number;
  invitesPerInviter: number | null;
  /** Of invitesSent: status joined/qualified and the invitee is a real user (to date). */
  invitesJoined: number;
  inviteJoinRate: number | null;
  /** Invites whose delivery failed (not in invitesSent). */
  invitesFailed: number;
  /** Distinct new real users brought in by the slice within 7 days of the inviter's sign-up. */
  friendsBroughtIn: number;
  /** friendsBroughtIn ÷ users (window: 7 days after each sign-up). */
  kFactor: number | null;
  /** Same, with no window (joins so far). */
  friendsToDate: number;
  kFactorToDate: number | null;
  /** In a non-public circle with ≥ 1 other real active member within 7 days of sign-up. */
  sociallyActivated: number;
  sociallyActivatedRate: number | null;
  circles: ViralityCircleStates;
  /** Network spend of the slice (same as the overview). */
  spend: number;
  /** Users of the slice an ad network brought in. */
  paidUsers: number;
  /** Friends (7-day window) those paid users brought in. */
  paidFriends: number;
  /** spend ÷ (paidUsers + paidFriends); null without spend. */
  blendedCac: number | null;
  /** spend ÷ paidUsers (for comparison); null without spend. */
  costPerPaidUser: number | null;
  /** True while a cohort day in the slice is younger than the 7-day window (numbers will still grow). */
  maturing: boolean;
}

export interface ViralityRow {
  key: string;
  groupBy: GroupBy;
  label: string;
  sublabel: string | null;
  channel: AttributionChannel | null;
  platform: string | null;
  level: AdLevel | null;
  externalId: string | null;
  campaignExternalId: string | null;
  metrics: ViralityMetrics;
}

export interface ViralityDay {
  /** Sign-up day (report time zone). */
  date: string;
  users: number;
  invited: number;
  friendsBroughtIn: number;
  sociallyActivated: number;
  /** The day's 7-day window has not closed yet. */
  maturing: boolean;
}

export interface ViralityCoverage {
  /** What the numbers include. */
  counted: string[];
  /** What they cannot include (not in the database). */
  notCounted: string[];
  /** Raw rows behind the numbers for this cohort (before test-user / window filters). */
  sourceRows: { referralInvites: number; referrals: number; circleInviteJoins: number };
}

export interface AdsVirality {
  range: { start: string; end: string; timeZone: string };
  groupBy: GroupBy;
  /** Every window used, in days after each user's sign-up. */
  window: { days: number; label: string };
  /** All cohort users (organic and unknown included — unlike the overview's paid-only totals). */
  totals: ViralityRow;
  rows: ViralityRow[];
  days: ViralityDay[];
  excludedUsers: ExcludedUsers;
  coverage: ViralityCoverage;
  definitions: Record<string, string>;
}

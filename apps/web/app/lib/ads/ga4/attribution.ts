/**
 * GA4 → user_attribution (docs/ADS_ATTRIBUTION_GA4.md). Pure: the SQL that reads
 * the GA4 BigQuery export, and the rules that turn its rows into upgrades.
 *
 * Google App campaign installs from Play search / YouTube / Discover /
 * view-through usually reach the app with an organic Play referrer; Google
 * attributes them by advertising-id matching inside Firebase / GA4. The export
 * carries that verdict per app instance (user_pseudo_id):
 *  - traffic_source.{source, medium, name}: first-user acquisition (google / cpc / <campaign name>)
 *  - session_traffic_source_last_click.google_ads_campaign: campaign / ad group ids
 *  - collected_traffic_source.gclid: a click id seen on an event
 * We join it to our users by GA4 user_id (= profile UUID, set by the Android app
 * on sign-in) or by user_attribution.app_instance_id (= user_pseudo_id).
 */
import type { AttributionRow } from '../types';

/** One aggregated app instance from the export (column names = ga4AttributionSql aliases). */
export interface Ga4InstanceRow {
  user_pseudo_id: string | null;
  user_id: string | null;
  first_open_micros: string | null;
  sign_up_micros: string | null;
  first_user_source: string | null;
  first_user_medium: string | null;
  first_user_campaign: string | null;
  manual_source: string | null;
  manual_medium: string | null;
  has_gclid: string | null;
  gads_customer_id: string | null;
  gads_campaign_id: string | null;
  gads_campaign_name: string | null;
  gads_ad_group_id: string | null;
  gads_ad_group_name: string | null;
}

export const GA4_SOURCE = 'google_ads_ga4';

/** Channels an upgrade may replace. A paid attribution is never touched. */
export const UPGRADABLE_CHANNELS = ['organic', 'unknown'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'cpm', 'display', 'video']);

/**
 * Daily export tables only (events_YYYYMMDD; _TABLE_SUFFIX BETWEEN on digits
 * excludes events_intraday_*). `project` / `dataset` are validated by
 * ga4BigQueryConfigFromEnv and cannot carry SQL; everything else is a parameter.
 */
export function ga4AttributionSql(project: string, dataset: string): string {
  const first = (expr: string, alias: string) => `ARRAY_AGG(${expr} IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS ${alias}`;
  return [
    'SELECT',
    '  user_pseudo_id,',
    '  ARRAY_AGG(user_id IGNORE NULLS ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS user_id,',
    "  CAST(MIN(IF(event_name = 'first_open', event_timestamp, NULL)) AS STRING) AS first_open_micros,",
    "  CAST(MIN(IF(event_name = 'sign_up', event_timestamp, NULL)) AS STRING) AS sign_up_micros,",
    `  ${first('traffic_source.source', 'first_user_source')},`,
    `  ${first('traffic_source.medium', 'first_user_medium')},`,
    `  ${first('traffic_source.name', 'first_user_campaign')},`,
    `  ${first('collected_traffic_source.manual_source', 'manual_source')},`,
    `  ${first('collected_traffic_source.manual_medium', 'manual_medium')},`,
    '  CAST(LOGICAL_OR(collected_traffic_source.gclid IS NOT NULL) AS STRING) AS has_gclid,',
    `  ${first('session_traffic_source_last_click.google_ads_campaign.customer_id', 'gads_customer_id')},`,
    `  ${first('session_traffic_source_last_click.google_ads_campaign.campaign_id', 'gads_campaign_id')},`,
    `  ${first('session_traffic_source_last_click.google_ads_campaign.campaign_name', 'gads_campaign_name')},`,
    `  ${first('session_traffic_source_last_click.google_ads_campaign.ad_group_id', 'gads_ad_group_id')},`,
    `  ${first('session_traffic_source_last_click.google_ads_campaign.ad_group_name', 'gads_ad_group_name')}`,
    `FROM \`${project}.${dataset}.events_*\``,
    'WHERE _TABLE_SUFFIX BETWEEN @start AND @end',
    "  AND platform = 'ANDROID'",
    '  AND app_info.id = @app_id',
    "  AND (event_name IN ('first_open', 'sign_up') OR (event_name = 'session_start' AND user_id IS NOT NULL))",
    'GROUP BY user_pseudo_id',
    'LIMIT 100000',
  ].join('\n');
}

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();
const clean = (v: string | null | undefined, max = 128) => {
  const s = String(v ?? '').trim();
  return s && s !== '(not set)' && s !== '(direct)' ? s.slice(0, max) : null;
};
const microsToIso = (v: string | null) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(Math.floor(n / 1000)).toISOString() : null;
};

export interface Ga4Evidence {
  userPseudoId: string;
  matchedBy: 'user_id' | 'app_instance_id';
  /** Why we call it Google Ads. */
  signals: Array<'google_ads_campaign' | 'gclid' | 'first_user_cpc' | 'manual_cpc'>;
  firstUserSource: string | null;
  firstUserMedium: string | null;
  firstUserCampaign: string | null;
  googleAdsCustomerId: string | null;
  googleAdsCampaignId: string | null;
  googleAdsCampaignName: string | null;
  googleAdsAdGroupId: string | null;
  googleAdsAdGroupName: string | null;
  firstOpenAt: string | null;
  signUpAt: string | null;
}

/** Google Ads signals of one instance (empty = not Google Ads). */
export function googleAdsSignals(r: Ga4InstanceRow): Ga4Evidence['signals'] {
  const out: Ga4Evidence['signals'] = [];
  if (clean(r.gads_campaign_id)) out.push('google_ads_campaign');
  if (norm(r.has_gclid) === 'true') out.push('gclid');
  if (norm(r.first_user_source) === 'google' && PAID_MEDIUMS.has(norm(r.first_user_medium))) out.push('first_user_cpc');
  if (norm(r.manual_source) === 'google' && PAID_MEDIUMS.has(norm(r.manual_medium))) out.push('manual_cpc');
  return out;
}

export function evidenceOf(r: Ga4InstanceRow, matchedBy: Ga4Evidence['matchedBy']): Ga4Evidence {
  return {
    userPseudoId: String(r.user_pseudo_id),
    matchedBy,
    signals: googleAdsSignals(r),
    firstUserSource: clean(r.first_user_source),
    firstUserMedium: clean(r.first_user_medium),
    firstUserCampaign: clean(r.first_user_campaign),
    googleAdsCustomerId: clean(r.gads_customer_id, 32),
    googleAdsCampaignId: clean(r.gads_campaign_id, 64),
    googleAdsCampaignName: clean(r.gads_campaign_name),
    googleAdsAdGroupId: clean(r.gads_ad_group_id, 64),
    googleAdsAdGroupName: clean(r.gads_ad_group_name),
    firstOpenAt: microsToIso(r.first_open_micros),
    signUpAt: microsToIso(r.sign_up_micros),
  };
}

export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

export type PlanOutcome = 'insert' | 'upgrade' | 'already_paid' | 'already_ga4' | 'test' | 'no_profile';

export interface PlannedChange {
  userId: string;
  outcome: PlanOutcome;
  row: AttributionRow | null;
}

/**
 * What to do for one matched user. `campaignIdByName` maps Google Ads campaign
 * names (ad_entities) → ids, for when the export has only first-user names.
 */
export function planChange(
  userId: string,
  existing: AttributionRow | null,
  profileExists: boolean,
  ev: Ga4Evidence,
  campaignIdByName: Map<string, string>,
  syncedAt: string
): PlannedChange {
  if (existing?.is_test) return { userId, outcome: 'test', row: null };
  if (existing && existing.channel === 'google_ads' && existing.source === GA4_SOURCE) return { userId, outcome: 'already_ga4', row: null };
  if (existing && !(UPGRADABLE_CHANNELS as readonly string[]).includes(existing.channel)) return { userId, outcome: 'already_paid', row: null };
  if (!existing && !profileExists) return { userId, outcome: 'no_profile', row: null };
  const campaignId =
    ev.googleAdsCampaignId ??
    (ev.googleAdsCampaignName ? campaignIdByName.get(ev.googleAdsCampaignName.toLowerCase()) : undefined) ??
    (ev.firstUserCampaign ? campaignIdByName.get(ev.firstUserCampaign.toLowerCase()) : undefined) ??
    null;
  const previous = existing ? { channel: existing.channel, source: existing.source, raw: existing.raw ?? null, reportedAt: existing.reported_at ?? null } : null;
  const row: AttributionRow = {
    user_id: userId,
    channel: 'google_ads',
    platform: existing?.platform ?? 'android',
    source: GA4_SOURCE,
    campaign_external_id: campaignId,
    ad_group_external_id: ev.googleAdsAdGroupId,
    keyword_external_id: null,
    ad_external_id: null,
    click_at: existing?.click_at ?? null,
    country: existing?.country ?? null,
    is_test: false,
    raw: { ga4: { ...ev, syncedAt }, ...(previous ? { previous } : {}) },
  };
  return { userId, outcome: existing ? 'upgrade' : 'insert', row };
}

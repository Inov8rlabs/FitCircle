/**
 * GA4 → user_attribution (docs/ADS_ATTRIBUTION_GA4.md). Pure: the SQL that reads
 * the GA4 BigQuery export, and the rules that turn its rows into changes.
 *
 * Google App campaign installs from Play search / YouTube / Discover /
 * view-through usually reach the app with an organic Play referrer; Google
 * attributes them by advertising-id matching inside Firebase / GA4. The export
 * carries that verdict per app instance (user_pseudo_id):
 *  - traffic_source.{source, medium, name}: first-user acquisition (google / cpc / <campaign name>)
 *  - session_traffic_source_last_click.google_ads_campaign: campaign / ad group ids + names
 *  - collected_traffic_source.gclid: a click id seen on an event
 * We join it to our users by GA4 user_id (= profile UUID, set by the Android app
 * on sign-in), by user_attribution.app_instance_id (= user_pseudo_id), or, for
 * installs that have neither, by the time + geo + device fallback (./matcher.ts).
 */
import type { AttributionRow } from '../types';

import { ga4CountryToIso2 } from './countries';
import type { Confidence, PairEvidence } from './matcher';

/** One aggregated app instance from the export (column names = ga4AttributionSql aliases). */
export interface Ga4InstanceRow {
  user_pseudo_id: string | null;
  user_id: string | null;
  first_open_micros: string | null;
  first_touch_micros?: string | null;
  first_event_micros?: string | null;
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
  geo_country?: string | null;
  geo_region?: string | null;
  geo_city?: string | null;
  device_brand?: string | null;
  device_model?: string | null;
  device_marketing_name?: string | null;
  device_hardware_model?: string | null;
  app_version?: string | null;
}

export const GA4_SOURCE = 'google_ads_ga4';

/** Channels an upgrade may replace. A paid attribution is never touched. */
export const UPGRADABLE_CHANNELS = ['organic', 'unknown'] as const;
/** Channels the sync never writes to. */
export const PROTECTED_CHANNELS = ['apple_ads', 'meta'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'cpm', 'display', 'video']);
const NUMERIC_ID_RE = /^\d{4,20}$/;

/**
 * Daily export tables only (events_YYYYMMDD; _TABLE_SUFFIX BETWEEN on digits
 * excludes events_intraday_*). `project` / `dataset` are validated by
 * ga4BigQueryConfigFromEnv and cannot carry SQL; everything else is a parameter.
 * Reads first_open / sign_up / session_start only (one row per instance out);
 * the gclid itself is never read out, only whether one was seen.
 */
export function ga4AttributionSql(project: string, dataset: string): string {
  const first = (expr: string, alias: string) => `ARRAY_AGG(${expr} IGNORE NULLS ORDER BY event_timestamp LIMIT 1)[SAFE_OFFSET(0)] AS ${alias}`;
  return [
    'SELECT',
    '  user_pseudo_id,',
    '  ARRAY_AGG(user_id IGNORE NULLS ORDER BY event_timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS user_id,',
    "  CAST(MIN(IF(event_name = 'first_open', event_timestamp, NULL)) AS STRING) AS first_open_micros,",
    '  CAST(MIN(user_first_touch_timestamp) AS STRING) AS first_touch_micros,',
    '  CAST(MIN(event_timestamp) AS STRING) AS first_event_micros,',
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
    `  ${first('session_traffic_source_last_click.google_ads_campaign.ad_group_name', 'gads_ad_group_name')},`,
    `  ${first('geo.country', 'geo_country')},`,
    `  ${first('geo.region', 'geo_region')},`,
    `  ${first('geo.city', 'geo_city')},`,
    `  ${first('device.mobile_brand_name', 'device_brand')},`,
    `  ${first('device.mobile_model_name', 'device_model')},`,
    `  ${first('device.mobile_marketing_name', 'device_marketing_name')},`,
    `  ${first('device.mobile_os_hardware_model', 'device_hardware_model')},`,
    `  ${first('app_info.version', 'app_version')}`,
    `FROM \`${project}.${dataset}.events_*\``,
    'WHERE _TABLE_SUFFIX BETWEEN @start AND @end',
    "  AND platform = 'ANDROID'",
    '  AND app_info.id = @app_id',
    "  AND event_name IN ('first_open', 'sign_up', 'session_start')",
    'GROUP BY user_pseudo_id',
    'LIMIT 100000',
  ].join('\n');
}

/** Earliest and latest daily export table (events_YYYYMMDD), for clamping a backfill. */
export function ga4TablesSql(project: string, dataset: string): string {
  return [
    'SELECT MIN(table_name) AS first_table, MAX(table_name) AS last_table, CAST(COUNT(*) AS STRING) AS tables',
    `FROM \`${project}.${dataset}.INFORMATION_SCHEMA.TABLES\``,
    "WHERE REGEXP_CONTAINS(table_name, r'^events_[0-9]{8}$')",
  ].join('\n');
}

const norm = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase();
export const clean = (v: string | null | undefined, max = 128) => {
  const s = String(v ?? '').trim();
  return s && s !== '(not set)' && s !== '(direct)' && s !== '(none)' ? s.slice(0, max) : null;
};
const microsToMs = (v: string | null | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : null;
};
const microsToIso = (v: string | null | undefined) => {
  const ms = microsToMs(v);
  return ms === null ? null : new Date(ms).toISOString();
};

/** Install time of an instance: first_open, else user_first_touch_timestamp (only when inside the export window it was read from). */
export function instanceFirstOpenMs(r: Ga4InstanceRow): number | null {
  return microsToMs(r.first_open_micros) ?? microsToMs(r.first_touch_micros);
}

/** GA4 device strings worth comparing, deduped. */
export function instanceDevices(r: Ga4InstanceRow): string[] {
  return [...new Set([r.device_hardware_model, r.device_model, r.device_marketing_name].map((v) => clean(v, 64)).filter((v): v is string => !!v))];
}

export type MatchedBy = 'user_id' | 'app_instance_id' | 'heuristic_time_geo_device';

export interface Ga4Evidence {
  userPseudoId: string;
  matched_by: MatchedBy;
  confidence: Confidence;
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
  country: string | null;
  region: string | null;
  device: string | null;
  appVersion: string | null;
  /** Fallback-matcher evidence (time delta, country / device agreement, fields used). */
  heuristic?: PairEvidence;
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

export function evidenceOf(r: Ga4InstanceRow, matchedBy: MatchedBy, confidence: Confidence = 'exact', heuristic?: PairEvidence): Ga4Evidence {
  return {
    userPseudoId: String(r.user_pseudo_id),
    matched_by: matchedBy,
    confidence,
    signals: googleAdsSignals(r),
    firstUserSource: clean(r.first_user_source),
    firstUserMedium: clean(r.first_user_medium),
    firstUserCampaign: clean(r.first_user_campaign),
    googleAdsCustomerId: clean(r.gads_customer_id, 32),
    googleAdsCampaignId: clean(r.gads_campaign_id, 64),
    googleAdsCampaignName: clean(r.gads_campaign_name),
    googleAdsAdGroupId: clean(r.gads_ad_group_id, 64),
    googleAdsAdGroupName: clean(r.gads_ad_group_name),
    firstOpenAt: microsToIso(r.first_open_micros ?? r.first_touch_micros),
    signUpAt: microsToIso(r.sign_up_micros),
    country: ga4CountryToIso2(r.geo_country),
    region: clean(r.geo_region, 64),
    device: instanceDevices(r)[0] ?? null,
    appVersion: clean(r.app_version, 32),
    ...(heuristic ? { heuristic } : {}),
  };
}

export const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

/** Google Ads campaign id carried in the Play referrer (gad_campaignid), if any. */
export function referrerCampaignId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let v = r.gad_campaignid ?? r.gad_campaign_id;
  const ref = r.referrer ?? r.installReferrer ?? r.install_referrer;
  if ((v === undefined || v === null) && typeof ref === 'string' && ref.includes('=')) {
    try {
      v = new URLSearchParams(ref).get('gad_campaignid');
    } catch {
      v = null;
    }
  }
  const s = String(v ?? '').trim();
  return NUMERIC_ID_RE.test(s) ? s : null;
}

/** Google Ads ad entities, for resolving names (the export may carry only names) and for the preview. */
export interface GoogleAdsCatalog {
  /** lower-case campaign name → id */
  campaignIdByName: Map<string, string>;
  /** `${campaignId}|${lower-case ad group name}` → ad group id */
  adGroupIdByKey: Map<string, string>;
  /** id → name, campaigns and ad groups */
  nameById: Map<string, string>;
}

export function buildCatalog(entities: ReadonlyArray<{ level: string; external_id: string; parent_external_id?: string | null; name: string | null }>): GoogleAdsCatalog {
  const c: GoogleAdsCatalog = { campaignIdByName: new Map(), adGroupIdByKey: new Map(), nameById: new Map() };
  for (const e of entities) {
    if (e.name) c.nameById.set(e.external_id, e.name);
    if (e.level === 'campaign' && e.name) c.campaignIdByName.set(e.name.toLowerCase(), e.external_id);
    if (e.level === 'ad_group' && e.name && e.parent_external_id) c.adGroupIdByKey.set(`${e.parent_external_id}|${e.name.toLowerCase()}`, e.external_id);
  }
  return c;
}

export function resolveCampaign(ev: Pick<Ga4Evidence, 'googleAdsCampaignId' | 'googleAdsCampaignName' | 'firstUserCampaign' | 'googleAdsAdGroupId' | 'googleAdsAdGroupName'>, catalog: GoogleAdsCatalog): { campaignId: string | null; adGroupId: string | null } {
  const campaignId =
    ev.googleAdsCampaignId ??
    (ev.googleAdsCampaignName ? catalog.campaignIdByName.get(ev.googleAdsCampaignName.toLowerCase()) : undefined) ??
    (ev.firstUserCampaign ? catalog.campaignIdByName.get(ev.firstUserCampaign.toLowerCase()) : undefined) ??
    null;
  const adGroupId = ev.googleAdsAdGroupId ?? (campaignId && ev.googleAdsAdGroupName ? catalog.adGroupIdByKey.get(`${campaignId}|${ev.googleAdsAdGroupName.toLowerCase()}`) : undefined) ?? null;
  return { campaignId, adGroupId };
}

export type PlanOutcome =
  | 'insert' // no row: insert google_ads
  | 'upgrade' // organic / unknown → google_ads
  | 'enrich' // google_ads without campaign → campaign / ad group filled
  | 'already_paid' // apple_ads / meta: never touched
  | 'already_campaign' // google_ads with a campaign already (incl. manual backfills): done
  | 'no_new_info' // google_ads without campaign, and the evidence has none either
  | 'not_google' // matched, but GA4 shows no Google Ads signal
  | 'test' // test / QA / internal user: never written
  | 'no_profile';

export interface AttributionSnapshot {
  channel: string;
  source: string;
  campaign_external_id: string | null;
  ad_group_external_id: string | null;
  app_instance_id: string | null;
}

export interface PlannedChange {
  userId: string;
  outcome: PlanOutcome;
  /** How the campaign / channel was found. */
  method: MatchedBy | 'referrer_gad_campaignid' | 'sole_google_campaign';
  confidence: Confidence;
  current: AttributionSnapshot | null;
  proposed: AttributionSnapshot | null;
  /** insert = full row; upgrade = full row; enrich = patch. Null when nothing is written. */
  write: { kind: 'insert' | 'upgrade' | 'enrich'; row: Partial<AttributionRow> & { user_id: string } } | null;
  evidence: Record<string, unknown>;
}

export const snapshotOf = (a: AttributionRow | null): AttributionSnapshot | null =>
  a ? { channel: a.channel, source: a.source, campaign_external_id: a.campaign_external_id ?? null, ad_group_external_id: a.ad_group_external_id ?? null, app_instance_id: a.app_instance_id ?? null } : null;

const previousOf = (a: AttributionRow) => ({
  channel: a.channel,
  source: a.source,
  campaign_external_id: a.campaign_external_id ?? null,
  ad_group_external_id: a.ad_group_external_id ?? null,
  app_instance_id: a.app_instance_id ?? null,
  raw: a.raw ?? null,
  reportedAt: a.reported_at ?? null,
});

const rawObject = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {});

export interface PlanInput {
  userId: string;
  existing: AttributionRow | null;
  profileExists: boolean;
  /** Test / QA / internal (testFlags non-empty). */
  isTest: boolean;
  ev: Ga4Evidence;
  catalog: GoogleAdsCatalog;
  syncedAt: string;
}

/**
 * Guards (in order): test users and test rows are never written; apple_ads /
 * meta never; google_ads with a campaign is done; google_ads without one is
 * enriched only when the evidence names a campaign; organic / unknown is
 * upgraded only on a Google Ads signal. The previous row goes to raw.previous.
 */
export function planChange(i: PlanInput): PlannedChange {
  const { userId, existing, ev, catalog, syncedAt } = i;
  const base = { userId, method: ev.matched_by, confidence: ev.confidence, current: snapshotOf(existing), evidence: { ga4: ev } } as const;
  const none = (outcome: PlanOutcome): PlannedChange => ({ ...base, outcome, proposed: null, write: null });
  if (i.isTest || existing?.is_test) return none('test');
  if (existing && (PROTECTED_CHANNELS as readonly string[]).includes(existing.channel)) return none('already_paid');
  if (existing?.channel === 'google_ads' && existing.campaign_external_id) return none('already_campaign');
  const google = ev.signals.length > 0;
  const { campaignId, adGroupId } = resolveCampaign(ev, catalog);
  const ga4 = { ...ev, syncedAt };

  if (existing?.channel === 'google_ads') {
    if (!campaignId) return none(google ? 'no_new_info' : 'not_google');
    const patch = {
      user_id: userId,
      campaign_external_id: campaignId,
      ad_group_external_id: existing.ad_group_external_id ?? adGroupId,
      app_instance_id: existing.app_instance_id ?? ev.userPseudoId,
      raw: { ...rawObject(existing.raw), ga4, previous: previousOf({ ...existing, raw: null }) },
    };
    return {
      ...base,
      outcome: 'enrich',
      proposed: { channel: 'google_ads', source: existing.source, campaign_external_id: campaignId, ad_group_external_id: patch.ad_group_external_id, app_instance_id: patch.app_instance_id },
      write: { kind: 'enrich', row: patch },
    };
  }
  if (!google) return none('not_google');
  if (existing && !(UPGRADABLE_CHANNELS as readonly string[]).includes(existing.channel)) return none('already_paid');
  if (!existing && !i.profileExists) return none('no_profile');
  const row: AttributionRow = {
    user_id: userId,
    channel: 'google_ads',
    platform: existing?.platform ?? 'android',
    source: GA4_SOURCE,
    campaign_external_id: campaignId,
    ad_group_external_id: adGroupId,
    keyword_external_id: null,
    ad_external_id: null,
    click_at: existing?.click_at ?? null,
    country: existing?.country ?? ev.country ?? null,
    is_test: false,
    raw: { ga4, ...(existing ? { previous: previousOf(existing) } : {}) },
    app_instance_id: existing?.app_instance_id ?? ev.userPseudoId,
  };
  return {
    ...base,
    outcome: existing ? 'upgrade' : 'insert',
    proposed: snapshotOf(row),
    write: { kind: existing ? 'upgrade' : 'insert', row },
  };
}

/**
 * google_ads rows without a campaign that GA4 did not resolve:
 *  - referrer_gad_campaignid (exact): the Play referrer carried gad_campaignid.
 *  - sole_google_campaign (low): the only Google Ads campaign that existed at
 *    sign-up. A gclid / gbraid proves Google Ads but not which campaign, so this
 *    is an inference and is applied only when min confidence is "low".
 */
export function planReferrerEnrichment(
  a: AttributionRow,
  isTest: boolean,
  catalog: GoogleAdsCatalog,
  soleCampaignId: string | null,
  syncedAt: string
): PlannedChange | null {
  if (a.channel !== 'google_ads' || a.campaign_external_id) return null;
  const fromReferrer = referrerCampaignId(a.raw);
  const campaignId = fromReferrer ?? soleCampaignId;
  if (!campaignId) return null;
  const method = fromReferrer ? 'referrer_gad_campaignid' : 'sole_google_campaign';
  const confidence: Confidence = fromReferrer ? 'exact' : 'low';
  const base = { userId: a.user_id, method, confidence, current: snapshotOf(a) } as const;
  const evidence = { matched_by: method, confidence, campaignId, campaignName: catalog.nameById.get(campaignId) ?? null, syncedAt };
  if (isTest || a.is_test) return { ...base, outcome: 'test', proposed: null, write: null, evidence };
  const patch = {
    user_id: a.user_id,
    campaign_external_id: campaignId,
    raw: { ...rawObject(a.raw), campaign_enrichment: evidence, previous: previousOf({ ...a, raw: null }) },
  };
  return {
    ...base,
    outcome: 'enrich',
    proposed: { ...snapshotOf(a)!, campaign_external_id: campaignId },
    write: { kind: 'enrich', row: patch },
    evidence,
  };
}

/**
 * Google Ads API (REST, v26) connector — READ-ONLY (docs/ADS_CONSOLE_SPEC.md §2).
 * Off until GOOGLE_ADS_SA_KEY is set.
 *
 * Auth: a Google Cloud service account (GOOGLE_ADS_SA_KEY = the key JSON, raw or
 * base64) that was added directly as a user on the Google Ads client account.
 * We mint an access token with the OAuth 2.0 JWT-bearer grant (RS256, node
 * crypto) for scope https://www.googleapis.com/auth/adwords — no user OAuth, no
 * domain-wide delegation.
 *
 * Developer tokens were sunset on 2026-09-09: API access levels now belong to
 * the Google Cloud project that owns the OAuth credentials (here the service
 * account's project). The `developer-token` header is optional and ignored, so
 * it is only sent when GOOGLE_ADS_DEVELOPER_TOKEN is set.
 * https://developers.google.com/google-ads/api/docs/api-policy/developer-token
 *
 * Every call is `googleAds:search` (GAQL). There is no mutate call anywhere in
 * this file and `applyChange` always throws; guardrails also list no writable
 * fields for google_ads.
 *
 * Mapping notes:
 *  - Campaign = campaign, ad group = `ad_group`. Costs are micros → dollars.
 *  - Installs = metrics.biddable_app_install_conversions ("Number of app
 *    installs", the App-campaign install column), rounded per row.
 *  - Days (segments.date) are in the account time zone (America/Toronto).
 *  - Quota: 4 search operations per sync (campaigns, ad groups, campaign and ad
 *    group daily metrics) + 1 token mint; hourly = ~96 ops/day against the
 *    Explorer level's 2,880.
 */
import { createSign } from 'node:crypto';

import type { AdChangeRequest, AdDailyMetricInput, AdEntityInput, AdEntityRef, AdPlatform, ConnectorChangeResult } from '../types';

import { type AdsConnector, ConnectorError, type DeliveryFieldTotals, type FetchLike, type NetworkTotals } from './types';

export const GOOGLE_ADS_API_VERSION = 'v26';
export const GOOGLE_ADS_API = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
export const DEFAULT_GOOGLE_ADS_CUSTOMER_ID = '7708137566';

export interface GoogleServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

export interface GoogleAdsCredentials {
  key: GoogleServiceAccountKey;
  customerId: string; // digits only
  loginCustomerId: string | null;
  developerToken: string | null;
}

const digits = (v: string | undefined | null) => (v ?? '').replace(/\D/g, '');

/** GOOGLE_ADS_SA_KEY: the key JSON as-is, quoted, or base64 of it. Null when unusable. */
export function parseServiceAccountKey(raw: string | undefined | null): GoogleServiceAccountKey | null {
  if (!raw || !raw.trim()) return null;
  let text = raw.trim();
  if (text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1);
  const tryJson = (s: string): any => {
    try {
      const v = JSON.parse(s);
      return typeof v === 'string' ? JSON.parse(v) : v; // double-encoded JSON string
    } catch {
      return null;
    }
  };
  let json = tryJson(text);
  if (!json && !text.startsWith('{')) json = tryJson(Buffer.from(text, 'base64').toString('utf8'));
  if (!json || typeof json.client_email !== 'string' || typeof json.private_key !== 'string') return null;
  return {
    client_email: json.client_email,
    private_key: json.private_key.replace(/\\n/g, '\n'),
    private_key_id: json.private_key_id,
    token_uri: json.token_uri,
  };
}

export function googleAdsCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): GoogleAdsCredentials | null {
  const key = parseServiceAccountKey(env.GOOGLE_ADS_SA_KEY);
  if (!key) return null;
  const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID) || DEFAULT_GOOGLE_ADS_CUSTOMER_ID;
  return {
    key,
    customerId,
    loginCustomerId: digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null,
    developerToken: env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || null,
  };
}

/** RS256 JWT assertion for the JWT-bearer token grant (RFC 7523). */
export function googleJwtAssertion(key: GoogleServiceAccountKey, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope: GOOGLE_ADS_SCOPE, aud: key.token_uri || GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = createSign('RSA-SHA256').update(input).sign(key.private_key).toString('base64url');
  return `${input}.${sig}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const clearGoogleTokenCache = () => tokenCache.clear();

type Json = Record<string, any>;

const micros = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n / 10_000) / 100 : null;
};
const int = (v: unknown) => Math.round(Number(v) || 0);

/** "yyyy-MM-dd HH:mm:ss" in `tz` → ISO instant. */
export function zonedToIso(local: unknown, tz: string): string | null {
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(local)) return null;
  const [d, t = '00:00:00'] = local.trim().split(/[ T]/);
  const asUtc = Date.parse(`${d}T${t.length === 5 ? `${t}:00` : t}Z`);
  if (!Number.isFinite(asUtc)) return null;
  // Offset of tz at that instant (two passes handle DST edges well enough for day-granular dates).
  const offset = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value])
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
  };
  let ms = asUtc - offset(asUtc);
  ms = asUtc - offset(ms);
  return new Date(ms).toISOString();
}

export function googlePlatform(campaign: Json | undefined | null): AdPlatform {
  const store = campaign?.appCampaignSetting?.appStore;
  if (store === 'APPLE_APP_STORE') return 'ios';
  if (store === 'GOOGLE_APP_STORE') return 'android';
  return campaign?.advertisingChannelType === 'MULTI_CHANNEL' ? 'android' : 'all';
}

// --- GAQL --------------------------------------------------------------------

export const GAQL_CUSTOMER = 'SELECT customer.id, customer.currency_code, customer.time_zone FROM customer LIMIT 1';

export const GAQL_CAMPAIGNS = [
  'SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.primary_status,',
  'campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy_type,',
  'campaign.start_date_time, campaign.end_date_time, campaign.app_campaign_setting.app_id,',
  'campaign.app_campaign_setting.app_store, campaign.app_campaign_setting.bidding_strategy_goal_type,',
  'campaign.target_cpa.target_cpa_micros, campaign_budget.amount_micros, campaign_budget.total_amount_micros,',
  'customer.currency_code, customer.time_zone',
  "FROM campaign WHERE campaign.status != 'REMOVED'",
].join(' ');

export const GAQL_AD_GROUPS = [
  'SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.primary_status, ad_group.type,',
  'ad_group.target_cpa_micros, campaign.id',
  "FROM ad_group WHERE ad_group.status != 'REMOVED' AND campaign.status != 'REMOVED'",
].join(' ');

const METRIC_FIELDS =
  'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.all_conversions, metrics.biddable_app_install_conversions, metrics.biddable_app_post_install_conversions';

export const gaqlCampaignDaily = (start: string, end: string) =>
  `SELECT campaign.id, segments.date, customer.currency_code, ${METRIC_FIELDS} FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`;

// The biddable_app_* install metrics are campaign-only: GAQL rejects them FROM ad_group
// (PROHIBITED_METRIC_IN_SELECT_OR_WHERE_CLAUSE), so ad-group rows carry conversions instead.
const AD_GROUP_METRIC_FIELDS = 'metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.all_conversions';

export const gaqlAdGroupDaily = (start: string, end: string) =>
  `SELECT ad_group.id, campaign.id, segments.date, customer.currency_code, ${AD_GROUP_METRIC_FIELDS} FROM ad_group WHERE segments.date BETWEEN '${start}' AND '${end}'`;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const assertYmd = (v: string) => {
  if (!YMD.test(v)) throw new ConnectorError(`Google Ads: bad date ${v}`);
  return v;
};

// --- mapping -----------------------------------------------------------------

export function mapGoogleCampaign(row: Json, tz = 'America/Toronto'): AdEntityInput {
  const c = row.campaign ?? {};
  const b = row.campaignBudget ?? {};
  const currency = row.customer?.currencyCode ?? 'USD';
  const target = micros(c.targetCpa?.targetCpaMicros);
  return {
    channel: 'google_ads',
    platform: googlePlatform(c),
    level: 'campaign',
    externalId: String(c.id),
    parentExternalId: null,
    campaignExternalId: String(c.id),
    name: c.name ?? null,
    status: c.status ?? null,
    // SERVING / PENDING / ENDED / SUSPENDED (primary_status, e.g. LIMITED or LEARNING, stays in raw).
    servingStatus: c.servingStatus ?? null,
    bidStrategy: c.biddingStrategyType ?? null,
    bidAmount: target,
    bidCurrency: currency,
    dailyBudget: micros(b.amountMicros),
    totalBudget: micros(b.totalAmountMicros),
    matchType: null,
    countries: null,
    startAt: zonedToIso(c.startDateTime, tz),
    endAt: zonedToIso(c.endDateTime, tz),
    creative: null,
    raw: row,
  };
}

export function mapGoogleAdGroup(row: Json, campaign?: AdEntityInput | null, currency = 'USD'): AdEntityInput {
  const g = row.adGroup ?? {};
  const cid = row.campaign?.id ? String(row.campaign.id) : null;
  return {
    channel: 'google_ads',
    platform: campaign?.platform ?? 'android',
    level: 'ad_group',
    externalId: String(g.id),
    parentExternalId: cid,
    campaignExternalId: cid,
    name: g.name ?? null,
    status: g.status ?? null,
    servingStatus: null,
    bidStrategy: campaign?.bidStrategy ?? null,
    bidAmount: micros(g.targetCpaMicros),
    bidCurrency: currency,
    dailyBudget: null,
    totalBudget: null,
    matchType: null,
    countries: null,
    startAt: null,
    endAt: null,
    creative: null,
    raw: row,
  };
}

/** Installs for a metrics row: the App-campaign install column. */
/**
 * Installs: biddable_app_install_conversions where Google returns it (campaign rows).
 * Ad-group rows can't select it, so they fall back to conversions — for an App
 * installs campaign the bid-to conversion is the install (first open).
 */
export const googleInstalls = (m: Json | undefined | null) =>
  m?.biddableAppInstallConversions !== undefined ? int(m.biddableAppInstallConversions) : int(m?.conversions);

/** GAQL daily rows (campaign or ad_group resource) → AdDailyMetricInput, summing duplicates in micros. */
export function mapGoogleDaily(rows: Json[], level: 'campaign' | 'ad_group'): AdDailyMetricInput[] {
  const acc = new Map<string, AdDailyMetricInput & { _micros: number }>();
  for (const r of rows) {
    const date = String(r.segments?.date ?? '').slice(0, 10);
    const cid = r.campaign?.id ? String(r.campaign.id) : null;
    const id = level === 'campaign' ? cid : r.adGroup?.id ? String(r.adGroup.id) : null;
    if (!date || !id) continue;
    const key = `${id}|${date}`;
    const row = acc.get(key) ?? {
      channel: 'google_ads' as const,
      level,
      externalId: id,
      campaignExternalId: cid,
      date,
      spend: 0,
      currency: r.customer?.currencyCode ?? 'USD',
      impressions: 0,
      taps: 0,
      installs: 0,
      newDownloads: 0,
      redownloads: 0,
      _micros: 0,
    };
    const m = r.metrics ?? {};
    row._micros += Number(m.costMicros) || 0;
    row.spend = Math.round(row._micros / 10_000) / 100;
    row.impressions += int(m.impressions);
    row.taps += int(m.clicks);
    const inst = googleInstalls(m);
    row.installs += inst;
    row.newDownloads += inst;
    acc.set(key, row);
  }
  return [...acc.values()].map(({ _micros, ...rest }) => rest);
}

export function totalsFromDaily(rows: AdDailyMetricInput[]): DeliveryFieldTotals {
  const t: DeliveryFieldTotals = { spend: 0, currency: rows[0]?.currency ?? null, impressions: 0, taps: 0, installs: 0 };
  let cents = 0;
  for (const r of rows) {
    cents += Math.round(r.spend * 100);
    t.impressions += r.impressions;
    t.taps += r.taps;
    t.installs += r.installs;
  }
  t.spend = cents / 100;
  return t;
}

// --- connector ---------------------------------------------------------------

export class GoogleAdsConnector implements AdsConnector {
  readonly channel = 'google_ads' as const;
  private readonly fetchImpl: FetchLike;
  private readonly creds: () => GoogleAdsCredentials | null;
  private tz = 'America/Toronto';
  private currency = 'USD';

  constructor(opts: { fetch?: FetchLike; credentials?: GoogleAdsCredentials | null } = {}) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.creds = opts.credentials !== undefined ? () => opts.credentials! : () => googleAdsCredentialsFromEnv();
  }

  isConfigured(): boolean {
    return this.creds() !== null;
  }

  private requireCreds(): GoogleAdsCredentials {
    const c = this.creds();
    if (!c) throw new ConnectorError('Google Ads is not configured (GOOGLE_ADS_SA_KEY missing)');
    return c;
  }

  async accessToken(): Promise<string> {
    const c = this.requireCreds();
    const cacheKey = c.key.client_email;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let assertion: string;
    try {
      assertion = googleJwtAssertion(c.key);
    } catch (e: any) {
      throw new ConnectorError(`Google Ads token: could not sign JWT (${e?.message ?? 'bad private_key'})`);
    }
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
    const res = await this.fetchImpl(c.key.token_uri || GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new ConnectorError(`Google Ads token: HTTP ${res.status}`, res.status, text.slice(0, 300));
    let json: Json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* handled below */
    }
    if (!json.access_token) throw new ConnectorError('Google Ads token: no access_token');
    const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 3600_000;
    tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + ttl });
    return json.access_token;
  }

  /** One GAQL search (read-only), following nextPageToken. */
  async search(query: string): Promise<Json[]> {
    const c = this.requireCreds();
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (c.developerToken) headers['developer-token'] = c.developerToken;
    if (c.loginCustomerId) headers['login-customer-id'] = c.loginCustomerId;
    const url = `${GOOGLE_ADS_API}/customers/${c.customerId}/googleAds:search`;
    const out: Json[] = [];
    let pageToken: string | undefined;
    for (let i = 0; i < 20; i++) {
      const res = await this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(pageToken ? { query, pageToken } : { query }) });
      const text = await res.text();
      let json: Json = {};
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 401) tokenCache.delete(c.key.client_email);
      if (!res.ok) {
        const detail = json?.error?.details?.[0]?.errors?.[0];
        const code = detail?.errorCode ? Object.entries(detail.errorCode).map(([k, v]) => `${k}=${v}`).join(',') : null;
        const msg = detail?.message ?? json?.error?.message ?? text.slice(0, 200);
        throw new ConnectorError(`Google Ads search: HTTP ${res.status}${code ? ` [${code}]` : ''}${msg ? ` — ${msg}` : ''}`, res.status, text.slice(0, 500));
      }
      out.push(...(Array.isArray(json.results) ? json.results : []));
      pageToken = json.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return out;
  }

  async fetchEntities(): Promise<AdEntityInput[]> {
    const campaigns = await this.search(GAQL_CAMPAIGNS);
    const first = campaigns[0]?.customer;
    if (first?.timeZone) this.tz = first.timeZone;
    if (first?.currencyCode) this.currency = first.currencyCode;
    const mapped = campaigns.map((r) => mapGoogleCampaign(r, this.tz));
    const byId = new Map(mapped.map((e) => [e.externalId, e]));
    const groups = await this.search(GAQL_AD_GROUPS);
    return [...mapped, ...groups.map((r) => mapGoogleAdGroup(r, byId.get(String(r.campaign?.id)), this.currency))];
  }

  async fetchDailyMetrics(start: string, end: string): Promise<AdDailyMetricInput[]> {
    assertYmd(start);
    assertYmd(end);
    const campaignRows = await this.search(gaqlCampaignDaily(start, end));
    const adGroupRows = await this.search(gaqlAdGroupDaily(start, end));
    return [...mapGoogleDaily(campaignRows, 'campaign'), ...mapGoogleDaily(adGroupRows, 'ad_group')];
  }

  async fetchTotals(start: string, end: string): Promise<NetworkTotals> {
    const rows = mapGoogleDaily(await this.search(gaqlCampaignDaily(assertYmd(start), assertYmd(end))), 'campaign');
    const byCampaign = new Map<string, AdDailyMetricInput[]>();
    for (const r of rows) byCampaign.set(r.externalId, [...(byCampaign.get(r.externalId) ?? []), r]);
    return {
      totals: totalsFromDaily(rows),
      campaigns: [...byCampaign.entries()].map(([id, rs]) => ({ campaignExternalId: id, name: null, fields: totalsFromDaily(rs) })),
    };
  }

  async reportTimeZone(): Promise<string | null> {
    const rows = await this.search(GAQL_CUSTOMER);
    return rows[0]?.customer?.timeZone ?? null;
  }

  async readEntity(ref: AdEntityRef): Promise<AdEntityInput | null> {
    const id = String(ref.externalId).replace(/\D/g, '');
    if (!id) return null;
    if (ref.level === 'campaign') {
      const rows = await this.search(`${GAQL_CAMPAIGNS} AND campaign.id = ${id}`);
      return rows[0] ? mapGoogleCampaign(rows[0], this.tz) : null;
    }
    if (ref.level === 'ad_group') {
      const rows = await this.search(`${GAQL_AD_GROUPS} AND ad_group.id = ${id}`);
      return rows[0] ? mapGoogleAdGroup(rows[0], null, this.currency) : null;
    }
    return null;
  }

  /** Read-only connector: never writes to Google Ads. */
  async applyChange(_change: AdChangeRequest): Promise<ConnectorChangeResult> {
    throw new ConnectorError('Google Ads connector is read-only');
  }
}

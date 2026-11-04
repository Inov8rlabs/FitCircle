/**
 * AdMob API (admob.googleapis.com v1) client — READ-ONLY
 * (docs/ADS_METRICS_METHODOLOGY.md §9). Off until the ADMOB_OAUTH_* env vars are set.
 *
 * Auth: the AdMob API does not accept service accounts. We hold an OAuth 2.0
 * refresh token of a Google account that has access to the AdMob publisher
 * account, minted once for scope admob.readonly (scripts/admob-oauth.mjs), and
 * exchange it for an access token on each sync.
 *
 * Env (read at call time; all secrets are sensitive Vercel env vars):
 *   ADMOB_OAUTH_CLIENT_ID      OAuth client (Desktop app) in a Cloud project with the AdMob API enabled
 *   ADMOB_OAUTH_CLIENT_SECRET
 *   ADMOB_OAUTH_REFRESH_TOKEN  refresh token for scope https://www.googleapis.com/auth/admob.readonly
 *   ADMOB_PUBLISHER_ID         optional, pub-XXXXXXXXXXXXXXXX (default: FitCircle's, from the apps' AdMob ids)
 *
 * The only calls are accounts.list (GET) and accounts.networkReport:generate
 * (a POST that only reads a report). Nothing here can change ad units or apps.
 *
 * Report notes:
 *  - The API accepts only America/Los_Angeles as the report time zone, so days
 *    are Pacific days (the console's other days are America/New_York).
 *  - ESTIMATED_EARNINGS is the only earnings metric (micros of the report
 *    currency). Finalised earnings appear only in AdMob → Payments.
 *  - Only additive metrics are requested; rates are derived on read.
 */
import { ConnectorError, type FetchLike } from '../connectors/types';
import { GOOGLE_TOKEN_URL } from '../connectors/google-ads';

export const ADMOB_API = 'https://admob.googleapis.com/v1';
export const ADMOB_SCOPE = 'https://www.googleapis.com/auth/admob.readonly';
/** From the apps' AdMob ids (ca-app-pub-1808316612259930~…). */
export const DEFAULT_ADMOB_PUBLISHER_ID = 'pub-1808316612259930';
export const ADMOB_REPORT_TIME_ZONE = 'America/Los_Angeles';

export interface AdmobCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  publisherId: string;
}

const PUB_RE = /^pub-\d{10,20}$/;

/** Null when anything required is missing (the sync then reports "not configured"). */
export function admobCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AdmobCredentials | null {
  const clientId = env.ADMOB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.ADMOB_OAUTH_CLIENT_SECRET?.trim();
  const refreshToken = env.ADMOB_OAUTH_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const pub = env.ADMOB_PUBLISHER_ID?.trim().replace(/^accounts\//, '') ?? '';
  return { clientId, clientSecret, refreshToken, publisherId: PUB_RE.test(pub) ? pub : DEFAULT_ADMOB_PUBLISHER_ID };
}

/** One row of the network report, additive metrics only (maps 1:1 to ad_revenue_daily). */
export interface AdRevenueDailyInput {
  source: 'admob';
  date: string; // YYYY-MM-DD, America/Los_Angeles
  appId: string;
  appName: string | null;
  platform: 'ios' | 'android' | 'unknown';
  adUnitId: string;
  adUnitName: string | null;
  format: string | null;
  country: string;
  currency: string;
  estimatedEarnings: number;
  adRequests: number;
  matchedRequests: number;
  impressions: number;
  clicks: number;
}

type Json = Record<string, any>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (ymd: string) => {
  if (!YMD.test(ymd)) throw new ConnectorError(`AdMob: bad date ${ymd}`);
  const [year, month, day] = ymd.split('-').map(Number);
  return { year, month, day };
};

export const ADMOB_DIMENSIONS = ['DATE', 'APP', 'PLATFORM', 'AD_UNIT', 'FORMAT', 'COUNTRY'] as const;
export const ADMOB_METRICS = ['ESTIMATED_EARNINGS', 'AD_REQUESTS', 'MATCHED_REQUESTS', 'IMPRESSIONS', 'CLICKS'] as const;

export function networkReportBody(start: string, end: string, currency = 'USD') {
  return {
    reportSpec: {
      dateRange: { startDate: toDate(start), endDate: toDate(end) },
      dimensions: [...ADMOB_DIMENSIONS],
      metrics: [...ADMOB_METRICS],
      localizationSettings: { currencyCode: currency, languageCode: 'en-US' },
      timeZone: ADMOB_REPORT_TIME_ZONE,
    },
  };
}

const intOf = (v: Json | undefined) => Math.round(Number(v?.integerValue ?? v?.doubleValue ?? 0) || 0);
const microsOf = (v: Json | undefined) => {
  const n = Number(v?.microsValue ?? NaN);
  if (Number.isFinite(n)) return n / 1_000_000;
  const d = Number(v?.doubleValue ?? 0);
  return Number.isFinite(d) ? d : 0;
};
const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function platformOf(v: string | null | undefined): AdRevenueDailyInput['platform'] {
  const s = String(v ?? '').toUpperCase();
  if (s === 'IOS') return 'ios';
  if (s === 'ANDROID') return 'android';
  return 'unknown';
}

/**
 * The networkReport:generate response (a JSON array of {header} {row}… {footer})
 * → rows. Duplicate keys (should not happen) are summed.
 */
export function parseNetworkReport(payload: unknown): { rows: AdRevenueDailyInput[]; currency: string; matchingRowCount: number | null } {
  const items: Json[] = Array.isArray(payload) ? payload : payload && typeof payload === 'object' ? [payload as Json] : [];
  let currency = 'USD';
  let matchingRowCount: number | null = null;
  const acc = new Map<string, AdRevenueDailyInput>();
  for (const item of items) {
    if (item.header) {
      currency = item.header.localizationSettings?.currencyCode ?? currency;
      continue;
    }
    if (item.footer) {
      const n = Number(item.footer.matchingRowCount);
      matchingRowCount = Number.isFinite(n) ? n : null;
      continue;
    }
    const row = item.row;
    if (!row) continue;
    const d = row.dimensionValues ?? {};
    const m = row.metricValues ?? {};
    const rawDate = String(d.DATE?.value ?? '');
    if (!/^\d{8}$/.test(rawDate)) continue;
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    const adUnitId = String(d.AD_UNIT?.value ?? '');
    if (!adUnitId) continue;
    const country = /^[A-Z]{2}$/.test(String(d.COUNTRY?.value ?? '')) ? String(d.COUNTRY.value) : 'ZZ';
    const key = `${date}|${adUnitId}|${country}`;
    const prev = acc.get(key);
    const next: AdRevenueDailyInput = prev ?? {
      source: 'admob',
      date,
      appId: String(d.APP?.value ?? 'unknown'),
      appName: d.APP?.displayLabel ?? null,
      platform: platformOf(d.PLATFORM?.value),
      adUnitId,
      adUnitName: d.AD_UNIT?.displayLabel ?? null,
      format: d.FORMAT?.value ?? null,
      country,
      currency,
      estimatedEarnings: 0,
      adRequests: 0,
      matchedRequests: 0,
      impressions: 0,
      clicks: 0,
    };
    next.estimatedEarnings = round6(next.estimatedEarnings + microsOf(m.ESTIMATED_EARNINGS));
    next.adRequests += intOf(m.AD_REQUESTS);
    next.matchedRequests += intOf(m.MATCHED_REQUESTS);
    next.impressions += intOf(m.IMPRESSIONS);
    next.clicks += intOf(m.CLICKS);
    acc.set(key, next);
  }
  return { rows: [...acc.values()].map((r) => ({ ...r, currency })), currency, matchingRowCount };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const clearAdmobTokenCache = () => tokenCache.clear();

export class AdmobClient {
  private readonly fetchImpl: FetchLike;
  private readonly creds: () => AdmobCredentials | null;

  constructor(opts: { fetch?: FetchLike; credentials?: AdmobCredentials | null } = {}) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.creds = opts.credentials !== undefined ? () => opts.credentials! : () => admobCredentialsFromEnv();
  }

  isConfigured(): boolean {
    return this.creds() !== null;
  }

  publisherId(): string | null {
    return this.creds()?.publisherId ?? null;
  }

  private requireCreds(): AdmobCredentials {
    const c = this.creds();
    if (!c) throw new ConnectorError('AdMob is not configured (ADMOB_OAUTH_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN missing)');
    return c;
  }

  /** Refresh-token grant → access token (cached until a minute before expiry). Never logs the token. */
  async accessToken(): Promise<string> {
    const c = this.requireCreds();
    const cacheKey = `${c.clientId}|${c.refreshToken.slice(-8)}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const res = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken }).toString(),
    });
    const text = await res.text().catch(() => '');
    let json: Json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* handled below */
    }
    if (!res.ok) {
      // invalid_grant = the refresh token was revoked / expired (OAuth app in "Testing" → 7-day tokens).
      const reason = typeof json.error === 'string' ? json.error : null;
      throw new ConnectorError(`AdMob token: HTTP ${res.status}${reason ? ` [${reason}]` : ''}${reason === 'invalid_grant' ? ' — re-run scripts/admob-oauth.mjs' : ''}`, res.status, null);
    }
    if (!json.access_token) throw new ConnectorError('AdMob token: no access_token');
    const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 3600_000;
    tokenCache.set(cacheKey, { token: json.access_token, expiresAt: Date.now() + ttl });
    return json.access_token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${ADMOB_API}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (res.status === 401) tokenCache.clear();
    if (!res.ok) {
      const err = Array.isArray(json) ? json[0]?.error : json?.error;
      const msg = err?.message ?? text.slice(0, 200);
      const status = err?.status ? ` [${err.status}]` : '';
      throw new ConnectorError(`AdMob: HTTP ${res.status}${status}${msg ? ` — ${msg}` : ''}`, res.status, text.slice(0, 500));
    }
    return json;
  }

  /** Publisher accounts the token can read (to confirm access / discover the pub id). */
  async listAccounts(): Promise<Array<{ publisherId: string; currencyCode: string | null; reportingTimeZone: string | null }>> {
    const json = (await this.call('accounts')) as Json | null;
    return (json?.account ?? []).map((a: Json) => ({
      publisherId: String(a.publisherId ?? String(a.name ?? '').replace(/^accounts\//, '')),
      currencyCode: a.currencyCode ?? null,
      reportingTimeZone: a.reportingTimeZone ?? null,
    }));
  }

  /** Network report for [start, end] (Pacific days), one row per day × ad unit × country. */
  async networkReport(start: string, end: string): Promise<ReturnType<typeof parseNetworkReport>> {
    const c = this.requireCreds();
    const payload = await this.call(`accounts/${encodeURIComponent(c.publisherId)}/networkReport:generate`, {
      method: 'POST',
      body: JSON.stringify(networkReportBody(start, end)),
    });
    return parseNetworkReport(payload);
  }
}

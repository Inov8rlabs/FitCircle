/**
 * Apple Ads (Search Ads) Campaign Management API v5 connector
 * (docs/ADS_CONSOLE_SPEC.md §2, §6).
 *
 * Auth: OAuth client-credentials. The client secret is an ES256 JWT signed with
 * the API user's EC P-256 key (APPLE_ADS_PRIVATE_KEY); the access token is
 * cached for its lifetime (~1 h). Every call carries `X-AP-Context: orgId=…`.
 * Requests are serial with limit 1000 pagination (Apple: ~10 req/s).
 *
 * Mapping notes (verified against live responses, fixtures in __tests__/fixtures):
 *  - Entity times are UTC without a zone ("2026-10-24T10:30:00.000").
 *  - Money is `{ amount: "2", currency: "USD" }`.
 *  - The bid strategy key is `biddingStrategy` (campaign and ad group).
 *  - Reports with granularity DAILY return `row[].granularity[]` with `date`
 *    plus metrics; days without delivery may carry only the date.
 *  - Ads on the default product page report as adId -1 ("Default Ad") per ad
 *    group; stored as `default-<adGroupId>`.
 */
import { createSign } from 'node:crypto';

import { addDays } from '../dates';
import type { AdChangeRequest, AdDailyMetricInput, AdEntityInput, AdEntityRef, ConnectorChangeResult } from '../types';

import { type AdsConnector, ConnectorError, type FetchLike } from './types';

export const APPLE_API = 'https://api.searchads.apple.com/api/v5';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/oauth2/token';
const PAGE = 1000;

export interface AppleAdsCredentials {
  clientId: string;
  teamId: string;
  keyId: string;
  orgId: string;
  privateKey: string;
}

/** Env PEMs often arrive with literal "\n" — restore real newlines. */
export function normalisePem(pem: string): string {
  let p = pem.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) p = p.slice(1, -1);
  return p.replace(/\\n/g, '\n');
}

export function appleCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): AppleAdsCredentials | null {
  const { APPLE_ADS_CLIENT_ID, APPLE_ADS_TEAM_ID, APPLE_ADS_KEY_ID, APPLE_ADS_ORG_ID, APPLE_ADS_PRIVATE_KEY } = env;
  if (!APPLE_ADS_CLIENT_ID || !APPLE_ADS_TEAM_ID || !APPLE_ADS_KEY_ID || !APPLE_ADS_ORG_ID || !APPLE_ADS_PRIVATE_KEY) return null;
  return {
    clientId: APPLE_ADS_CLIENT_ID,
    teamId: APPLE_ADS_TEAM_ID,
    keyId: APPLE_ADS_KEY_ID,
    orgId: APPLE_ADS_ORG_ID,
    privateKey: normalisePem(APPLE_ADS_PRIVATE_KEY),
  };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** ES256 client secret JWT for the token endpoint. */
export function appleClientSecret(c: AppleAdsCredentials, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'ES256', kid: c.keyId };
  const payload = { sub: c.clientId, aud: 'https://appleid.apple.com', iat: nowSec, exp: nowSec + 3600, iss: c.teamId };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('SHA256').update(input).sign({ key: c.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(sig)}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const clearAppleTokenCache = () => tokenCache.clear();

// ---------------------------------------------------------------------------
// Pure mapping (unit-tested against recorded responses)
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

export const appleMoney = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const amount = typeof v === 'object' ? (v as Json).amount : v;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
};
const appleCurrency = (v: unknown): string | null => (v && typeof v === 'object' ? ((v as Json).currency ?? null) : null);

/** "2026-10-24T10:30:00.000" (UTC, no zone) → ISO. */
export function appleTime(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function mapAppleCampaign(c: Json): AdEntityInput {
  return {
    channel: 'apple_ads',
    platform: 'ios',
    level: 'campaign',
    externalId: String(c.id),
    parentExternalId: null,
    campaignExternalId: String(c.id),
    name: c.name ?? null,
    status: c.status ?? null,
    servingStatus: c.displayStatus ?? c.servingStatus ?? null,
    bidStrategy: c.biddingStrategy ?? c.bidStrategy ?? null,
    bidAmount: null,
    bidCurrency: appleCurrency(c.dailyBudgetAmount) ?? appleCurrency(c.budgetAmount),
    dailyBudget: appleMoney(c.dailyBudgetAmount),
    totalBudget: appleMoney(c.budgetAmount),
    matchType: null,
    countries: Array.isArray(c.countriesOrRegions) ? c.countriesOrRegions : null,
    startAt: appleTime(c.startTime),
    endAt: appleTime(c.endTime),
    creative: null,
    raw: c,
  };
}

export function mapAppleAdGroup(g: Json, campaign?: Json | null): AdEntityInput {
  return {
    channel: 'apple_ads',
    platform: 'ios',
    level: 'ad_group',
    externalId: String(g.id),
    parentExternalId: str(g.campaignId),
    campaignExternalId: str(g.campaignId),
    name: g.name ?? null,
    status: g.status ?? null,
    servingStatus: g.displayStatus ?? g.servingStatus ?? null,
    bidStrategy: g.biddingStrategy ?? g.bidStrategy ?? campaign?.biddingStrategy ?? null,
    bidAmount: appleMoney(g.defaultBidAmount),
    bidCurrency: appleCurrency(g.defaultBidAmount),
    dailyBudget: null,
    totalBudget: null,
    matchType: null,
    countries: Array.isArray(campaign?.countriesOrRegions) ? campaign.countriesOrRegions : null,
    startAt: appleTime(g.startTime),
    endAt: appleTime(g.endTime),
    creative: null,
    raw: g,
  };
}

export function mapAppleKeyword(k: Json, adGroup?: Json | null): AdEntityInput {
  return {
    channel: 'apple_ads',
    platform: 'ios',
    level: 'keyword',
    externalId: String(k.id),
    parentExternalId: str(k.adGroupId),
    campaignExternalId: str(k.campaignId),
    name: k.text ?? null,
    status: k.status ?? null,
    servingStatus: k.deleted ? 'DELETED' : null,
    // Keywords inherit the ad group's strategy (guardrails need it on the row).
    bidStrategy: adGroup?.biddingStrategy ?? adGroup?.bidStrategy ?? null,
    bidAmount: appleMoney(k.bidAmount) ?? appleMoney(adGroup?.defaultBidAmount),
    bidCurrency: appleCurrency(k.bidAmount) ?? appleCurrency(adGroup?.defaultBidAmount),
    dailyBudget: null,
    totalBudget: null,
    matchType: k.matchType ?? null,
    countries: null,
    startAt: null,
    endAt: null,
    creative: null,
    raw: k,
  };
}

export const appleAdExternalId = (adId: unknown, adGroupId: unknown) => (Number(adId) === -1 || adId === null || adId === undefined ? `default-${adGroupId}` : String(adId));

/** Ad entity from an ads-report row's metadata (covers default product page ads too). */
export function mapAppleAdFromReport(meta: Json, productPages: Map<string, string>): AdEntityInput {
  const productPageId = str(meta.productPageId);
  const isDefault = Number(meta.adId) === -1 || meta.creativeType === 'DEFAULT_PRODUCT_PAGE';
  return {
    channel: 'apple_ads',
    platform: 'ios',
    level: 'ad',
    externalId: appleAdExternalId(meta.adId, meta.adGroupId),
    parentExternalId: str(meta.adGroupId),
    campaignExternalId: str(meta.campaignId),
    name: isDefault ? 'Default product page' : (meta.adName ?? null),
    status: meta.adStatus ?? meta.status ?? null,
    servingStatus: meta.adDisplayStatus ?? null,
    bidStrategy: null,
    bidAmount: null,
    bidCurrency: null,
    dailyBudget: null,
    totalBudget: null,
    matchType: null,
    countries: null,
    startAt: null,
    endAt: null,
    creative: {
      creativeId: Number(meta.creativeId) === -1 ? null : str(meta.creativeId),
      creativeType: meta.creativeType ?? null,
      productPageId,
      productPageName: isDefault ? 'Default product page' : productPageId ? (productPages.get(productPageId) ?? null) : null,
    },
    raw: meta,
  };
}

const REPORT_ID_KEY: Record<'campaign' | 'ad_group' | 'keyword' | 'ad', string> = {
  campaign: 'campaignId',
  ad_group: 'adGroupId',
  keyword: 'keywordId',
  ad: 'adId',
};

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Daily rows from a v5 report response (granularity DAILY). */
export function mapAppleReport(level: 'campaign' | 'ad_group' | 'keyword' | 'ad', json: Json): AdDailyMetricInput[] {
  const rows: Json[] = json?.data?.reportingDataResponse?.row ?? [];
  const out: AdDailyMetricInput[] = [];
  for (const r of rows) {
    const meta = r.metadata ?? {};
    const rawId = meta[REPORT_ID_KEY[level]];
    if (rawId === undefined || rawId === null) continue;
    const externalId = level === 'ad' ? appleAdExternalId(rawId, meta.adGroupId) : String(rawId);
    const campaignExternalId = str(meta.campaignId);
    for (const g of (r.granularity ?? []) as Json[]) {
      if (!g?.date) continue;
      out.push({
        channel: 'apple_ads',
        level,
        externalId,
        campaignExternalId,
        date: String(g.date).slice(0, 10),
        spend: appleMoney(g.localSpend) ?? 0,
        currency: appleCurrency(g.localSpend) ?? appleCurrency(r.total?.localSpend) ?? 'USD',
        impressions: int(g.impressions),
        taps: int(g.taps),
        installs: int(g.totalInstalls ?? g.tapInstalls ?? g.installs),
        newDownloads: int(g.totalNewDownloads ?? g.tapNewDownloads),
        redownloads: int(g.totalRedownloads ?? g.tapRedownloads),
      });
    }
  }
  return out;
}

export function reportBody(start: string, end: string, offset = 0) {
  return {
    startTime: start,
    endTime: end,
    granularity: 'DAILY',
    timeZone: 'ORTZ',
    returnRecordsWithNoMetrics: true,
    returnRowTotals: false,
    returnGrandTotals: false,
    selector: { orderBy: [{ field: 'localSpend', sortOrder: 'DESCENDING' }], pagination: { offset, limit: PAGE } },
  };
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export class AppleAdsConnector implements AdsConnector {
  readonly channel = 'apple_ads' as const;
  private readonly fetchImpl: FetchLike;
  private readonly creds: () => AppleAdsCredentials | null;

  constructor(opts: { fetch?: FetchLike; credentials?: AppleAdsCredentials | null } = {}) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.creds = opts.credentials !== undefined ? () => opts.credentials! : () => appleCredentialsFromEnv();
  }

  isConfigured(): boolean {
    return this.creds() !== null;
  }

  private requireCreds(): AppleAdsCredentials {
    const c = this.creds();
    if (!c) throw new ConnectorError('Apple Ads is not configured');
    return c;
  }

  async accessToken(): Promise<string> {
    const c = this.requireCreds();
    const cached = tokenCache.get(c.clientId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: appleClientSecret(c), scope: 'searchadsorg' });
    const res = await this.fetchImpl(APPLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    if (!res.ok) throw new ConnectorError(`Apple Ads token: HTTP ${res.status}`, res.status, (await res.text().catch(() => '')).slice(0, 300));
    const json = (await res.json()) as Json;
    if (!json.access_token) throw new ConnectorError('Apple Ads token: no access_token');
    const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 3600_000;
    tokenCache.set(c.clientId, { token: json.access_token, expiresAt: Date.now() + ttl });
    return json.access_token;
  }

  private async call(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<Json> {
    const c = this.requireCreds();
    const token = await this.accessToken();
    const res = await this.fetchImpl(`${APPLE_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'X-AP-Context': `orgId=${c.orgId}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) tokenCache.delete(c.clientId);
    if (!res.ok) {
      const msg = json?.error?.errors?.[0]?.message ?? text.slice(0, 200);
      throw new ConnectorError(`Apple Ads ${method} ${path.split('?')[0]}: HTTP ${res.status}${msg ? ` — ${msg}` : ''}`, res.status, text.slice(0, 500));
    }
    if (json?.error?.errors?.length) throw new ConnectorError(`Apple Ads ${method} ${path}: ${json.error.errors[0].message ?? 'error'}`, res.status, text.slice(0, 500));
    return json;
  }

  private async getAll(path: string): Promise<Json[]> {
    const out: Json[] = [];
    for (let offset = 0; offset < 50_000; offset += PAGE) {
      const sep = path.includes('?') ? '&' : '?';
      const json = await this.call('GET', `${path}${sep}limit=${PAGE}&offset=${offset}`);
      const data = Array.isArray(json.data) ? json.data : json.data ? [json.data] : [];
      out.push(...data);
      const total = Number(json.pagination?.totalResults ?? data.length);
      if (data.length < PAGE || out.length >= total) break;
    }
    return out;
  }

  private async report(path: string, start: string, end: string): Promise<Json[]> {
    const rows: Json[] = [];
    for (let offset = 0; offset < 50_000; offset += PAGE) {
      const json = await this.call('POST', path, reportBody(start, end, offset));
      const page: Json[] = json?.data?.reportingDataResponse?.row ?? [];
      rows.push(...page);
      const total = Number(json.pagination?.totalResults ?? page.length);
      if (page.length < PAGE || rows.length >= total) break;
    }
    return rows;
  }

  async listCampaigns(): Promise<Json[]> {
    return (await this.getAll('/campaigns')).filter((c) => !c.deleted);
  }

  async fetchEntities(): Promise<AdEntityInput[]> {
    const out: AdEntityInput[] = [];
    const campaigns = await this.listCampaigns();
    const productPages = new Map<string, string>();
    const seenApps = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const c of campaigns) {
      out.push(mapAppleCampaign(c));
      if (c.adamId && !seenApps.has(String(c.adamId))) {
        seenApps.add(String(c.adamId));
        try {
          for (const p of await this.getAll(`/apps/${c.adamId}/product-pages`)) productPages.set(String(p.id), p.name ?? String(p.id));
        } catch (e) {
          console.warn('[ads/apple] product pages lookup failed:', (e as Error).message);
        }
      }
      const groups = (await this.getAll(`/campaigns/${c.id}/adgroups`)).filter((g) => !g.deleted);
      for (const g of groups) {
        out.push(mapAppleAdGroup(g, c));
        const keywords = (await this.getAll(`/campaigns/${c.id}/adgroups/${g.id}/targetingkeywords`)).filter((k) => !k.deleted);
        for (const k of keywords) out.push(mapAppleKeyword(k, g));
      }
      // Ads (incl. the default product page) with their product page ids.
      const adRows = await this.report(`/reports/campaigns/${c.id}/ads`, addDays(today, -1), today);
      for (const r of adRows) if (r.metadata && !r.metadata.deleted) out.push(mapAppleAdFromReport({ campaignId: c.id, ...r.metadata }, productPages));
    }
    return out;
  }

  async fetchDailyMetrics(start: string, end: string): Promise<AdDailyMetricInput[]> {
    const out: AdDailyMetricInput[] = [];
    out.push(...mapAppleReport('campaign', { data: { reportingDataResponse: { row: await this.report('/reports/campaigns', start, end) } } }));
    const campaignIds = [...new Set(out.map((r) => r.externalId))];
    for (const id of campaignIds) {
      const wrap = (row: Json[]) => ({ data: { reportingDataResponse: { row } } });
      out.push(...mapAppleReport('ad_group', wrap(await this.report(`/reports/campaigns/${id}/adgroups`, start, end))));
      out.push(...mapAppleReport('keyword', wrap(await this.report(`/reports/campaigns/${id}/keywords`, start, end))));
      out.push(...mapAppleReport('ad', wrap(await this.report(`/reports/campaigns/${id}/ads`, start, end))));
    }
    return out;
  }

  async readEntity(ref: AdEntityRef): Promise<AdEntityInput | null> {
    const cid = ref.campaignExternalId;
    if (ref.level === 'campaign') return mapAppleCampaign((await this.call('GET', `/campaigns/${ref.externalId}`)).data);
    if (!cid) return null;
    if (ref.level === 'ad_group') {
      const [g, c] = [(await this.call('GET', `/campaigns/${cid}/adgroups/${ref.externalId}`)).data, (await this.call('GET', `/campaigns/${cid}`)).data];
      return mapAppleAdGroup(g, c);
    }
    if (ref.level === 'keyword' && ref.parentExternalId) {
      const g = (await this.call('GET', `/campaigns/${cid}/adgroups/${ref.parentExternalId}`)).data;
      const k = (await this.call('GET', `/campaigns/${cid}/adgroups/${ref.parentExternalId}/targetingkeywords/${ref.externalId}`)).data;
      return mapAppleKeyword(k, g);
    }
    return null;
  }

  /** The write request for a change (exported for tests). */
  static writeRequest(change: AdChangeRequest): { method: 'PUT'; path: string; body: unknown } {
    const money = (v: number | string) => ({ amount: Number(v).toFixed(2), currency: change.currency || 'USD' });
    const cid = change.campaignExternalId;
    const unsupported = () => new ConnectorError(`Apple Ads: ${change.field} on ${change.level} is not supported`);
    switch (change.level) {
      case 'campaign':
        if (change.field === 'daily_budget') return { method: 'PUT', path: `/campaigns/${change.externalId}`, body: { campaign: { dailyBudgetAmount: money(change.value) } } };
        if (change.field === 'status') return { method: 'PUT', path: `/campaigns/${change.externalId}`, body: { campaign: { status: String(change.value) } } };
        throw unsupported();
      case 'ad_group':
        if (!cid) throw unsupported();
        if (change.field === 'bid') return { method: 'PUT', path: `/campaigns/${cid}/adgroups/${change.externalId}`, body: { defaultBidAmount: money(change.value) } };
        if (change.field === 'status') return { method: 'PUT', path: `/campaigns/${cid}/adgroups/${change.externalId}`, body: { status: String(change.value) } };
        throw unsupported();
      case 'keyword': {
        if (!cid || !change.parentExternalId) throw unsupported();
        const path = `/campaigns/${cid}/adgroups/${change.parentExternalId}/targetingkeywords/bulk`;
        if (change.field === 'bid') return { method: 'PUT', path, body: [{ id: Number(change.externalId), bidAmount: money(change.value) }] };
        if (change.field === 'status') return { method: 'PUT', path, body: [{ id: Number(change.externalId), status: String(change.value) }] };
        throw unsupported();
      }
      default:
        throw unsupported();
    }
  }

  async applyChange(change: AdChangeRequest): Promise<ConnectorChangeResult> {
    const req = AppleAdsConnector.writeRequest(change);
    await this.call(req.method, req.path, req.body);
    const entity = await this.readEntity(change);
    const confirmedValue = !entity ? null : change.field === 'bid' ? entity.bidAmount : change.field === 'daily_budget' ? entity.dailyBudget : entity.status;
    return { confirmedValue, entity };
  }
}

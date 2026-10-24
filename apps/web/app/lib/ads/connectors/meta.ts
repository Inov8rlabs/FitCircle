/**
 * Meta Marketing API (Graph v23.0) connector (docs/ADS_CONSOLE_SPEC.md §2).
 * Off until META_ADS_ACCESS_TOKEN + META_ADS_ACCOUNT_ID are set.
 *
 * Mapping notes:
 *  - Campaign = campaign, ad set = `ad_group`, ad = `ad` (creative fields on it).
 *  - Budgets and bid_amount are in the account currency's minor units (cents).
 *  - bid_strategy lives on the ad set, or on the campaign under campaign budget
 *    optimisation; ad sets inherit it.
 *  - Insights are pulled at level=ad, time_increment=1 and rolled up to ad set
 *    and campaign in code (installs = action_type mobile_app_install).
 */
import type { AdChangeRequest, AdDailyMetricInput, AdEntityInput, AdEntityRef, ConnectorChangeResult } from '../types';

import { type AdsConnector, ConnectorError, type FetchLike } from './types';

export const META_GRAPH = 'https://graph.facebook.com/v23.0';

export interface MetaCredentials {
  accessToken: string;
  accountId: string; // without act_
}

export function metaCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): MetaCredentials | null {
  const token = env.META_ADS_ACCESS_TOKEN;
  const account = env.META_ADS_ACCOUNT_ID;
  if (!token || !account) return null;
  return { accessToken: token, accountId: account.replace(/^act_/, '') };
}

type Json = Record<string, any>;

const minor = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) / 100 : null;
};
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export const CAMPAIGN_FIELDS = 'id,name,status,effective_status,objective,bid_strategy,daily_budget,lifetime_budget,start_time,stop_time';
export const ADSET_FIELDS =
  'id,name,campaign_id,status,effective_status,bid_strategy,bid_amount,daily_budget,lifetime_budget,start_time,end_time,targeting{geo_locations},promoted_object';
export const AD_FIELDS = 'id,name,adset_id,campaign_id,status,effective_status,creative{id,name,thumbnail_url,title,body,object_store_url}';

/** Platform from the promoted app store URL (Android unless it's an App Store link). */
export function metaPlatform(adset?: Json | null): 'ios' | 'android' {
  const url = String(adset?.promoted_object?.object_store_url ?? '');
  return /apps\.apple\.com|itunes\.apple\.com/.test(url) ? 'ios' : 'android';
}

export function mapMetaCampaign(c: Json, currency = 'USD'): AdEntityInput {
  return {
    channel: 'meta',
    platform: 'android',
    level: 'campaign',
    externalId: String(c.id),
    parentExternalId: null,
    campaignExternalId: String(c.id),
    name: c.name ?? null,
    status: c.status ?? null,
    servingStatus: c.effective_status ?? null,
    bidStrategy: c.bid_strategy ?? null,
    bidAmount: null,
    bidCurrency: currency,
    dailyBudget: minor(c.daily_budget),
    totalBudget: minor(c.lifetime_budget),
    matchType: null,
    countries: null,
    startAt: iso(c.start_time),
    endAt: iso(c.stop_time),
    creative: null,
    raw: c,
  };
}

export function mapMetaAdSet(s: Json, campaign?: Json | null, currency = 'USD'): AdEntityInput {
  const countries = s.targeting?.geo_locations?.countries;
  return {
    channel: 'meta',
    platform: metaPlatform(s),
    level: 'ad_group',
    externalId: String(s.id),
    parentExternalId: s.campaign_id ? String(s.campaign_id) : null,
    campaignExternalId: s.campaign_id ? String(s.campaign_id) : null,
    name: s.name ?? null,
    status: s.status ?? null,
    servingStatus: s.effective_status ?? null,
    bidStrategy: s.bid_strategy ?? campaign?.bid_strategy ?? null,
    bidAmount: minor(s.bid_amount),
    bidCurrency: currency,
    dailyBudget: minor(s.daily_budget),
    totalBudget: minor(s.lifetime_budget),
    matchType: null,
    countries: Array.isArray(countries) ? countries : null,
    startAt: iso(s.start_time),
    endAt: iso(s.end_time),
    creative: null,
    raw: s,
  };
}

export function mapMetaAd(a: Json, adset?: Json | null): AdEntityInput {
  const cr = a.creative ?? {};
  return {
    channel: 'meta',
    platform: metaPlatform(adset),
    level: 'ad',
    externalId: String(a.id),
    parentExternalId: a.adset_id ? String(a.adset_id) : null,
    campaignExternalId: a.campaign_id ? String(a.campaign_id) : null,
    name: a.name ?? null,
    status: a.status ?? null,
    servingStatus: a.effective_status ?? null,
    bidStrategy: null,
    bidAmount: null,
    bidCurrency: null,
    dailyBudget: null,
    totalBudget: null,
    matchType: null,
    countries: null,
    startAt: null,
    endAt: null,
    creative: { creativeId: cr.id ? String(cr.id) : null, thumbnailUrl: cr.thumbnail_url ?? null, headline: cr.title ?? cr.name ?? null, body: cr.body ?? null },
    raw: a,
  };
}

const INSTALL_ACTIONS = ['mobile_app_install', 'omni_app_install', 'app_install'];

export function metaInstalls(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  for (const type of INSTALL_ACTIONS) {
    const hit = actions.find((a: Json) => a?.action_type === type);
    if (hit) return Math.round(Number(hit.value) || 0);
  }
  return 0;
}

/** Ad-level daily insights → ad, ad set and campaign rows. */
export function mapMetaInsights(rows: Json[], currency = 'USD'): AdDailyMetricInput[] {
  const acc = new Map<string, AdDailyMetricInput>();
  const bump = (level: 'campaign' | 'ad_group' | 'ad', id: string | undefined, campaignId: string | null, date: string, r: Json) => {
    if (!id) return;
    const key = `${level}|${id}|${date}`;
    const row = acc.get(key) ?? {
      channel: 'meta' as const,
      level,
      externalId: id,
      campaignExternalId: campaignId,
      date,
      spend: 0,
      currency: r.account_currency ?? currency,
      impressions: 0,
      taps: 0,
      installs: 0,
      newDownloads: 0,
      redownloads: 0,
    };
    row.spend = Math.round((row.spend + (Number(r.spend) || 0)) * 100) / 100;
    row.impressions += Math.round(Number(r.impressions) || 0);
    row.taps += Math.round(Number(r.clicks) || 0);
    const inst = metaInstalls(r.actions);
    row.installs += inst;
    row.newDownloads += inst;
    acc.set(key, row);
  };
  for (const r of rows) {
    const date = String(r.date_start ?? '').slice(0, 10);
    if (!date) continue;
    const cid = r.campaign_id ? String(r.campaign_id) : null;
    bump('ad', r.ad_id ? String(r.ad_id) : undefined, cid, date, r);
    bump('ad_group', r.adset_id ? String(r.adset_id) : undefined, cid, date, r);
    bump('campaign', cid ?? undefined, cid, date, r);
  }
  return [...acc.values()];
}

export class MetaAdsConnector implements AdsConnector {
  readonly channel = 'meta' as const;
  private readonly fetchImpl: FetchLike;
  private readonly creds: () => MetaCredentials | null;
  private currency = 'USD';

  constructor(opts: { fetch?: FetchLike; credentials?: MetaCredentials | null } = {}) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
    this.creds = opts.credentials !== undefined ? () => opts.credentials! : () => metaCredentialsFromEnv();
  }

  isConfigured(): boolean {
    return this.creds() !== null;
  }

  private requireCreds(): MetaCredentials {
    const c = this.creds();
    if (!c) throw new ConnectorError('Meta Ads is not configured');
    return c;
  }

  private async request(method: 'GET' | 'POST', pathOrUrl: string, params: Record<string, string> = {}): Promise<Json> {
    const c = this.requireCreds();
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${META_GRAPH}${pathOrUrl}`);
    let body: string | undefined;
    if (method === 'GET') {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', c.accessToken);
    } else {
      body = new URLSearchParams({ ...params, access_token: c.accessToken }).toString();
    }
    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      body,
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok || json.error) {
      throw new ConnectorError(`Meta ${method} ${url.pathname}: HTTP ${res.status}${json.error?.message ? ` — ${json.error.message}` : ''}`, res.status, text.slice(0, 500));
    }
    return json;
  }

  private async getAll(path: string, params: Record<string, string>): Promise<Json[]> {
    const out: Json[] = [];
    let json = await this.request('GET', path, { limit: '500', ...params });
    for (let i = 0; i < 100; i++) {
      out.push(...(json.data ?? []));
      const next = json.paging?.next;
      if (!next) break;
      json = await this.request('GET', next);
    }
    return out;
  }

  async fetchEntities(): Promise<AdEntityInput[]> {
    const { accountId } = this.requireCreds();
    try {
      const acct = await this.request('GET', `/act_${accountId}`, { fields: 'currency' });
      if (acct.currency) this.currency = acct.currency;
    } catch {
      /* keep USD */
    }
    const campaigns = await this.getAll(`/act_${accountId}/campaigns`, { fields: CAMPAIGN_FIELDS });
    const adsets = await this.getAll(`/act_${accountId}/adsets`, { fields: ADSET_FIELDS });
    const ads = await this.getAll(`/act_${accountId}/ads`, { fields: AD_FIELDS });
    const byCampaign = new Map(campaigns.map((c) => [String(c.id), c]));
    const byAdset = new Map(adsets.map((s) => [String(s.id), s]));
    const out: AdEntityInput[] = [];
    // Campaign platform follows its ad sets.
    for (const c of campaigns) {
      const e = mapMetaCampaign(c, this.currency);
      const sets = adsets.filter((s) => String(s.campaign_id) === String(c.id));
      if (sets.length && sets.every((s) => metaPlatform(s) === 'ios')) e.platform = 'ios';
      out.push(e);
    }
    for (const s of adsets) out.push(mapMetaAdSet(s, byCampaign.get(String(s.campaign_id)), this.currency));
    for (const a of ads) out.push(mapMetaAd(a, byAdset.get(String(a.adset_id))));
    return out;
  }

  async fetchDailyMetrics(start: string, end: string): Promise<AdDailyMetricInput[]> {
    const { accountId } = this.requireCreds();
    const rows = await this.getAll(`/act_${accountId}/insights`, {
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since: start, until: end }),
      fields: 'ad_id,adset_id,campaign_id,spend,impressions,clicks,actions,account_currency,date_start,date_stop',
    });
    return mapMetaInsights(rows, this.currency);
  }

  async readEntity(ref: AdEntityRef): Promise<AdEntityInput | null> {
    if (ref.level === 'campaign') return mapMetaCampaign(await this.request('GET', `/${ref.externalId}`, { fields: CAMPAIGN_FIELDS }), this.currency);
    if (ref.level === 'ad_group') {
      const s = await this.request('GET', `/${ref.externalId}`, { fields: ADSET_FIELDS });
      const c = s.campaign_id ? await this.request('GET', `/${s.campaign_id}`, { fields: CAMPAIGN_FIELDS }) : null;
      return mapMetaAdSet(s, c, this.currency);
    }
    if (ref.level === 'ad') return mapMetaAd(await this.request('GET', `/${ref.externalId}`, { fields: AD_FIELDS }));
    return null;
  }

  static writeParams(change: AdChangeRequest): Record<string, string> {
    const cents = (v: number | string) => String(Math.round(Number(v) * 100));
    if (change.field === 'bid' && change.level === 'ad_group') return { bid_amount: cents(change.value) };
    if (change.field === 'daily_budget' && (change.level === 'ad_group' || change.level === 'campaign')) return { daily_budget: cents(change.value) };
    if (change.field === 'status' && ['campaign', 'ad_group', 'ad'].includes(change.level)) return { status: String(change.value) };
    throw new ConnectorError(`Meta: ${change.field} on ${change.level} is not supported`);
  }

  async applyChange(change: AdChangeRequest): Promise<ConnectorChangeResult> {
    await this.request('POST', `/${change.externalId}`, MetaAdsConnector.writeParams(change));
    const entity = await this.readEntity(change);
    const confirmedValue = !entity ? null : change.field === 'bid' ? entity.bidAmount : change.field === 'daily_budget' ? entity.dailyBudget : entity.status;
    return { confirmedValue, entity };
  }
}

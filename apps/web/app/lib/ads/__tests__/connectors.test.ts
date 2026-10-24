/**
 * Connector response mapping from recorded fixtures (Apple: live read-only
 * responses captured 2026-10-24; Meta: Graph v23 shapes) + write request shapes
 * against a mocked fetch. Nothing here talks to a network.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appleClientSecret,
  AppleAdsConnector,
  appleTime,
  clearAppleTokenCache,
  mapAppleAdFromReport,
  mapAppleAdGroup,
  mapAppleCampaign,
  mapAppleKeyword,
  mapAppleReport,
  normalisePem,
  appleCredentialsFromEnv,
} from '../connectors/apple-ads';
import { mapMetaAd, mapMetaAdSet, mapMetaCampaign, mapMetaInsights, MetaAdsConnector, metaCredentialsFromEnv, metaInstalls } from '../connectors/meta';

import adgroups from './fixtures/apple/adgroups.json';
import campaigns from './fixtures/apple/campaigns.json';
import keywords from './fixtures/apple/keywords.json';
import reportAdGroups from './fixtures/apple/report_adgroups.json';
import reportAds from './fixtures/apple/report_ads.json';
import reportCampaigns from './fixtures/apple/report_campaigns.json';
import reportKeywords from './fixtures/apple/report_keywords.json';
import reportKeywordsDelivery from './fixtures/apple/report_keywords_delivery.json';
import metaEntities from './fixtures/meta/entities.json';
import metaInsights from './fixtures/meta/insights.json';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const CREDS = { clientId: 'SEARCHADS.test-client', teamId: 'SEARCHADS.test-team', keyId: 'key-1', orgId: '25006540', privateKey: PEM };

describe('Apple Ads auth', () => {
  it('client secret is an ES256 JWT with the documented claims, signed ieee-p1363', () => {
    const jwt = appleClientSecret(CREDS, 1_800_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'key-1' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({
      sub: 'SEARCHADS.test-client',
      aud: 'https://appleid.apple.com',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
      iss: 'SEARCHADS.test-team',
    });
    const sig = Buffer.from(s, 'base64url');
    expect(sig.length).toBe(64); // raw r||s, not DER
    expect(createVerify('SHA256').update(`${h}.${p}`).verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true);
  });

  it('normalises PEMs with literal \\n and quotes from env', () => {
    const escaped = `"${PEM.trim().replace(/\n/g, '\\n')}"`;
    expect(normalisePem(escaped)).toBe(PEM.trim());
    const creds = appleCredentialsFromEnv({
      APPLE_ADS_CLIENT_ID: 'a',
      APPLE_ADS_TEAM_ID: 'b',
      APPLE_ADS_KEY_ID: 'c',
      APPLE_ADS_ORG_ID: '1',
      APPLE_ADS_PRIVATE_KEY: escaped,
    } as any);
    expect(creds?.privateKey).toBe(PEM.trim());
    expect(appleCredentialsFromEnv({} as any)).toBeNull();
  });
});

describe('Apple Ads entity mapping (live fixtures)', () => {
  const c = campaigns.data[0];
  const g = adgroups.data[0];

  it('campaign', () => {
    expect(mapAppleCampaign(c)).toMatchObject({
      channel: 'apple_ads',
      platform: 'ios',
      level: 'campaign',
      externalId: '2144950391',
      name: 'US - Search - Concept test (CPP)',
      status: 'ENABLED',
      servingStatus: 'RUNNING',
      bidStrategy: 'MANUAL_CPT',
      dailyBudget: 50,
      totalBudget: null,
      bidCurrency: 'USD',
      countries: ['US'],
      startAt: '2026-10-24T10:30:00.000Z',
      endAt: '2026-11-06T05:00:00.000Z',
    });
  });

  it('ad group', () => {
    const e = mapAppleAdGroup(g, c);
    expect(e).toMatchObject({ level: 'ad_group', externalId: '2152121621', parentExternalId: '2144950391', campaignExternalId: '2144950391', bidAmount: 2, bidStrategy: 'MANUAL_CPT', status: 'ENABLED', countries: ['US'] });
    expect((e.raw as any).automatedKeywordsOptIn).toBe(false);
    expect((e.raw as any).pricingModel).toBe('CPC');
  });

  it('keyword inherits the ad group strategy', () => {
    const e = mapAppleKeyword(keywords.data[0], g);
    expect(e).toMatchObject({ level: 'keyword', externalId: '2360029480', parentExternalId: '2152121621', campaignExternalId: '2144950391', name: 'calorie counter', matchType: 'EXACT', status: 'ACTIVE', bidAmount: 2, bidStrategy: 'MANUAL_CPT' });
  });

  it('default product page ad from the ads report', () => {
    const meta = { ...reportAds.data.reportingDataResponse.row[0].metadata };
    const e = mapAppleAdFromReport(meta, new Map());
    expect(e).toMatchObject({ level: 'ad', externalId: 'default-2152121621', parentExternalId: '2152121621', name: 'Default product page', creative: { productPageName: 'Default product page', productPageId: null, creativeType: 'DEFAULT_PRODUCT_PAGE' } });
  });

  it('custom product page ad gets its page name', () => {
    const e = mapAppleAdFromReport({ adId: 77, adName: 'CPP - snap', creativeType: 'CUSTOM_PRODUCT_PAGE', creativeId: 55, productPageId: 'abc-123', adGroupId: 1, campaignId: 2, adStatus: 'ENABLED' }, new Map([['abc-123', 'Snap a meal']]));
    expect(e).toMatchObject({ externalId: '77', name: 'CPP - snap', creative: { productPageId: 'abc-123', productPageName: 'Snap a meal', creativeId: '55' } });
  });

  it('times without a zone are UTC', () => {
    expect(appleTime('2026-10-24T10:30:00.000')).toBe('2026-10-24T10:30:00.000Z');
    expect(appleTime(null)).toBeNull();
  });
});

describe('Apple Ads report mapping', () => {
  it('zero-delivery days still produce rows (returnRecordsWithNoMetrics)', () => {
    const rows = mapAppleReport('campaign', reportCampaigns);
    expect(rows.map((r) => r.date)).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
    expect(rows[3]).toEqual({ channel: 'apple_ads', level: 'campaign', externalId: '2144950391', campaignExternalId: '2144950391', date: '2026-10-24', spend: 0, currency: 'USD', impressions: 0, taps: 0, installs: 0, newDownloads: 0, redownloads: 0 });
    expect(mapAppleReport('ad_group', reportAdGroups)[0]).toMatchObject({ level: 'ad_group', externalId: '2152121621' });
    expect(mapAppleReport('keyword', reportKeywords)).toHaveLength(8);
    expect(mapAppleReport('ad', reportAds)[0]).toMatchObject({ level: 'ad', externalId: 'default-2152121621' });
  });

  it('reads daily metrics from granularity rows', () => {
    const rows = mapAppleReport('keyword', reportKeywordsDelivery);
    expect(rows[0]).toMatchObject({ externalId: '2360029480', date: '2026-10-24', spend: 12.34, impressions: 410, taps: 9, installs: 4, newDownloads: 3, redownloads: 1 });
    expect(rows[1]).toMatchObject({ date: '2026-10-25', spend: 0, installs: 0 });
  });
});

describe('Apple Ads connector (mocked fetch)', () => {
  beforeEach(() => clearAppleTokenCache());

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('caches the token and sends X-AP-Context', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('oauth2/token')) return json({ access_token: 'tok', expires_in: 3600 });
      return json(campaigns);
    });
    const conn = new AppleAdsConnector({ fetch: fetchMock, credentials: CREDS });
    await conn.listCampaigns();
    await conn.listCampaigns();
    expect(calls.filter((c) => c.url.includes('oauth2/token'))).toHaveLength(1);
    const tokenBody = new URLSearchParams(String(calls[0].init?.body));
    expect(tokenBody.get('grant_type')).toBe('client_credentials');
    expect(tokenBody.get('scope')).toBe('searchadsorg');
    expect(tokenBody.get('client_id')).toBe(CREDS.clientId);
    const api = calls.find((c) => c.url.startsWith('https://api.searchads.apple.com/api/v5/campaigns'))!;
    expect((api.init?.headers as Record<string, string>)['X-AP-Context']).toBe('orgId=25006540');
    expect((api.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('fetchEntities walks campaigns → ad groups → keywords → ads report', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('oauth2/token')) return json({ access_token: 'tok', expires_in: 3600 });
      if (url.includes('/product-pages')) return json({ data: [] });
      if (url.includes('/targetingkeywords')) return json(keywords);
      if (url.includes('/adgroups')) return json(adgroups);
      if (url.includes('/reports/campaigns/2144950391/ads')) return json(reportAds);
      if (url.includes('/campaigns')) return json(campaigns);
      return json({}, 404);
    });
    const entities = await new AppleAdsConnector({ fetch: fetchMock, credentials: CREDS }).fetchEntities();
    expect(entities.map((e) => e.level)).toEqual(['campaign', 'ad_group', 'keyword', 'keyword', 'keyword', 'ad']);
  });

  it('write requests match the v5 endpoints', () => {
    const base = { channel: 'apple_ads' as const, campaignExternalId: '2144950391', currency: 'USD' };
    expect(AppleAdsConnector.writeRequest({ ...base, level: 'keyword', externalId: '2360029480', parentExternalId: '2152121621', field: 'bid', value: 2.5 })).toEqual({
      method: 'PUT',
      path: '/campaigns/2144950391/adgroups/2152121621/targetingkeywords/bulk',
      body: [{ id: 2360029480, bidAmount: { amount: '2.50', currency: 'USD' } }],
    });
    expect(AppleAdsConnector.writeRequest({ ...base, level: 'ad_group', externalId: '2152121621', parentExternalId: '2144950391', field: 'bid', value: 1.8 })).toEqual({
      method: 'PUT',
      path: '/campaigns/2144950391/adgroups/2152121621',
      body: { defaultBidAmount: { amount: '1.80', currency: 'USD' } },
    });
    expect(AppleAdsConnector.writeRequest({ ...base, level: 'campaign', externalId: '2144950391', parentExternalId: null, field: 'daily_budget', value: 60 })).toEqual({
      method: 'PUT',
      path: '/campaigns/2144950391',
      body: { campaign: { dailyBudgetAmount: { amount: '60.00', currency: 'USD' } } },
    });
    expect(AppleAdsConnector.writeRequest({ ...base, level: 'campaign', externalId: '2144950391', parentExternalId: null, field: 'status', value: 'PAUSED' }).body).toEqual({ campaign: { status: 'PAUSED' } });
    expect(() => AppleAdsConnector.writeRequest({ ...base, level: 'campaign', externalId: '1', parentExternalId: null, field: 'bid', value: 1 })).toThrow(/not supported/);
  });

  it('applyChange PUTs then re-reads and returns the confirmed value', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${url.replace('https://api.searchads.apple.com/api/v5', '')}`);
      if (url.includes('oauth2/token')) return json({ access_token: 'tok', expires_in: 3600 });
      if (url.endsWith('/targetingkeywords/bulk')) return json({ data: [] });
      if (url.includes('/targetingkeywords/2360029480')) return json({ data: { ...keywords.data[0], bidAmount: { amount: '2.5', currency: 'USD' } } });
      if (url.includes('/adgroups/2152121621')) return json({ data: adgroups.data[0] });
      return json({}, 404);
    });
    const res = await new AppleAdsConnector({ fetch: fetchMock, credentials: CREDS }).applyChange({
      channel: 'apple_ads',
      level: 'keyword',
      externalId: '2360029480',
      parentExternalId: '2152121621',
      campaignExternalId: '2144950391',
      field: 'bid',
      value: 2.5,
      currency: 'USD',
    });
    expect(res.confirmedValue).toBe(2.5);
    expect(seen).toContain('PUT /campaigns/2144950391/adgroups/2152121621/targetingkeywords/bulk');
  });

  it('surfaces API errors with status', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.includes('oauth2/token') ? json({ access_token: 'tok' }) : json({ error: { errors: [{ message: 'forbidden for this role' }] } }, 403)));
    await expect(new AppleAdsConnector({ fetch: fetchMock, credentials: CREDS }).listCampaigns()).rejects.toThrow(/HTTP 403 — forbidden for this role/);
  });

  it('not configured without env', () => {
    expect(new AppleAdsConnector({ credentials: null }).isConfigured()).toBe(false);
  });
});

describe('Meta mapping', () => {
  const [campaign] = metaEntities.campaigns.data;
  const [capped, auto] = metaEntities.adsets.data;

  it('campaign / ad set / ad (minor units → dollars, inherited bid strategy)', () => {
    expect(mapMetaCampaign(campaign)).toMatchObject({ channel: 'meta', level: 'campaign', externalId: '120200000000000001', dailyBudget: 50, status: 'ACTIVE' });
    expect(mapMetaAdSet(capped, campaign)).toMatchObject({ level: 'ad_group', platform: 'android', bidStrategy: 'COST_CAP', bidAmount: 3.5, dailyBudget: 25, countries: ['US'], campaignExternalId: '120200000000000001' });
    expect(mapMetaAdSet(auto, campaign)).toMatchObject({ bidStrategy: 'LOWEST_COST_WITHOUT_CAP', bidAmount: null });
    expect(mapMetaAd(metaEntities.ads.data[0], capped)).toMatchObject({
      level: 'ad',
      parentExternalId: '120200000000000011',
      creative: { thumbnailUrl: 'https://scontent.example/thumb.jpg', headline: 'Snap a meal. Get the macros.', body: 'Photo to calories in seconds.' },
    });
  });

  it('insights roll up ad → ad set → campaign per day; installs = mobile_app_install', () => {
    const rows = mapMetaInsights(metaInsights.data);
    const find = (level: string, id: string, date: string) => rows.find((r) => r.level === level && r.externalId === id && r.date === date);
    expect(find('ad', '120200000000000101', '2026-10-25')).toMatchObject({ spend: 7.21, impressions: 1800, taps: 40, installs: 6 });
    expect(find('ad_group', '120200000000000011', '2026-10-25')).toMatchObject({ spend: 10, impressions: 2500, taps: 50, installs: 7 });
    expect(find('campaign', '120200000000000001', '2026-10-26')).toMatchObject({ spend: 5, installs: 0 });
    expect(metaInstalls(undefined)).toBe(0);
  });

  it('is off without META_ADS_ACCESS_TOKEN', () => {
    expect(metaCredentialsFromEnv({ META_ADS_ACCOUNT_ID: 'act_1' } as any)).toBeNull();
    expect(metaCredentialsFromEnv({ META_ADS_ACCOUNT_ID: 'act_1141795138521735', META_ADS_ACCESS_TOKEN: 't' } as any)).toEqual({ accessToken: 't', accountId: '1141795138521735' });
    expect(new MetaAdsConnector({ credentials: null }).isConfigured()).toBe(false);
  });

  it('follows paging and writes bid caps in cents', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/insights') && !url.includes('after=b')) return new Response(JSON.stringify({ data: metaInsights.data.slice(0, 2), paging: { next: 'https://graph.facebook.com/v23.0/act_1/insights?after=b&access_token=t' } }));
      if (url.includes('after=b')) return new Response(JSON.stringify({ data: metaInsights.data.slice(2) }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ success: true }));
      return new Response(JSON.stringify({ ...capped, bid_amount: '400' }));
    });
    const conn = new MetaAdsConnector({ fetch: fetchMock, credentials: { accessToken: 't', accountId: '1' } });
    const rows = await conn.fetchDailyMetrics('2026-10-25', '2026-10-26');
    expect(rows.filter((r) => r.level === 'campaign')).toHaveLength(2);
    expect(MetaAdsConnector.writeParams({ channel: 'meta', level: 'ad_group', externalId: 'x', parentExternalId: null, campaignExternalId: null, field: 'bid', value: 4, currency: 'USD' })).toEqual({ bid_amount: '400' });
    const res = await conn.applyChange({ channel: 'meta', level: 'ad_group', externalId: '120200000000000011', parentExternalId: null, campaignExternalId: null, field: 'bid', value: 4, currency: 'USD' });
    expect(res.confirmedValue).toBe(4);
    expect(urls.some((u) => u.startsWith('POST https://graph.facebook.com/v23.0/120200000000000011'))).toBe(true);
  });
});

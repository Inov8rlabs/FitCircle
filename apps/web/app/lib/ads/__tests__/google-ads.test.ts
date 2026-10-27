/**
 * Google Ads connector (read-only, REST v26 googleAds:search) against a mocked
 * fetch. Nothing here talks to a network.
 */
import { createVerify, generateKeyPairSync } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearGoogleTokenCache,
  DEFAULT_GOOGLE_ADS_CUSTOMER_ID,
  GAQL_AD_GROUPS,
  GAQL_CAMPAIGNS,
  GOOGLE_ADS_SCOPE,
  GoogleAdsConnector,
  type GoogleAdsCredentials,
  googleAdsCredentialsFromEnv,
  googleJwtAssertion,
  mapGoogleCampaign,
  mapGoogleDaily,
  parseServiceAccountKey,
  zonedToIso,
} from '../connectors/google-ads';
import { getConnector } from '../connectors';
import { writeEnabled } from '../config';
import { editability } from '../guardrails';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY_JSON = {
  type: 'service_account',
  project_id: 'fitcircle-fitness-app',
  private_key_id: 'kid-1',
  private_key: PEM,
  client_email: 'google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com',
  token_uri: 'https://oauth2.googleapis.com/token',
};
const CREDS: GoogleAdsCredentials = { key: parseServiceAccountKey(JSON.stringify(KEY_JSON))!, customerId: '7708137566', loginCustomerId: null, developerToken: null };

const CAMPAIGN_ROW = {
  campaign: {
    resourceName: 'customers/7708137566/campaigns/281499373901203',
    id: '281499373901203',
    name: 'FitCircle Android - US - Installs (test)',
    status: 'ENABLED',
    servingStatus: 'SERVING',
    primaryStatus: 'LEARNING',
    advertisingChannelType: 'MULTI_CHANNEL',
    advertisingChannelSubType: 'APP_CAMPAIGN',
    biddingStrategyType: 'TARGET_CPA',
    startDateTime: '2026-10-26 00:00:00',
    appCampaignSetting: { appId: 'com.inov8rlabs.apps.fitcircle', appStore: 'GOOGLE_APP_STORE', biddingStrategyGoalType: 'OPTIMIZE_INSTALLS_TARGET_INSTALL_COST' },
    targetCpa: { targetCpaMicros: '2500000' },
  },
  campaignBudget: { amountMicros: '15000000' },
  customer: { currencyCode: 'USD', timeZone: 'America/Toronto' },
};
const AD_GROUP_ROW = { adGroup: { id: '190000000001', name: 'Ad group 1', status: 'ENABLED', primaryStatus: 'ELIGIBLE', type: 'UNKNOWN' }, campaign: { id: '281499373901203' } };
const daily = (date: string, cost: string, impressions: string, clicks: string, installs: number, adGroup = false) => ({
  campaign: { id: '281499373901203' },
  ...(adGroup ? { adGroup: { id: '190000000001' } } : {}),
  segments: { date },
  customer: { currencyCode: 'USD' },
  metrics: { costMicros: cost, impressions, clicks, conversions: installs + 0.5, allConversions: installs + 3, biddableAppInstallConversions: installs, biddableAppPostInstallConversions: 1 },
});

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(handler: (url: string, body: any) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3599, token_type: 'Bearer' }), { status: 200 });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const r = handler(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  };
  return { fn, calls };
}

beforeEach(() => clearGoogleTokenCache());

describe('Google Ads config from env', () => {
  it('is a no-op (null) without GOOGLE_ADS_SA_KEY', () => {
    expect(googleAdsCredentialsFromEnv({} as any)).toBeNull();
    expect(googleAdsCredentialsFromEnv({ GOOGLE_ADS_SA_KEY: 'not json' } as any)).toBeNull();
    expect(new GoogleAdsConnector({ credentials: null }).isConfigured()).toBe(false);
  });

  it('accepts raw JSON or base64 JSON; customer id defaults to 770-813-7566; optional headers', () => {
    const raw = googleAdsCredentialsFromEnv({ GOOGLE_ADS_SA_KEY: JSON.stringify(KEY_JSON) } as any)!;
    expect(raw).toMatchObject({ customerId: DEFAULT_GOOGLE_ADS_CUSTOMER_ID, loginCustomerId: null, developerToken: null });
    expect(raw.key.client_email).toBe(KEY_JSON.client_email);
    expect(raw.key.private_key).toBe(PEM);
    const b64 = googleAdsCredentialsFromEnv({
      GOOGLE_ADS_SA_KEY: Buffer.from(JSON.stringify(KEY_JSON)).toString('base64'),
      GOOGLE_ADS_CUSTOMER_ID: '770-813-7566',
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: '730-058-5097',
      GOOGLE_ADS_DEVELOPER_TOKEN: 'devtok',
    } as any)!;
    expect(b64).toMatchObject({ customerId: '7708137566', loginCustomerId: '7300585097', developerToken: 'devtok' });
    expect(b64.key.private_key).toBe(PEM);
  });

  it('is always read-only: no write flag, no editable fields', () => {
    process.env.GOOGLE_ADS_WRITE_ENABLED = 'true';
    expect(writeEnabled('google_ads')).toBe(false);
    delete process.env.GOOGLE_ADS_WRITE_ENABLED;
    const e = editability({ channel: 'google_ads', level: 'campaign', bid_strategy: 'TARGET_CPA', daily_budget: 15, bid_amount: 2.5, status: 'ENABLED' } as any, { configured: true, writeEnabled: true });
    expect(e.bid.editable || e.dailyBudget.editable || e.status.editable).toBe(false);
    expect(getConnector('google_ads')?.channel).toBe('google_ads');
  });
});

describe('Google Ads auth', () => {
  it('JWT-bearer assertion is RS256 with the adwords scope', () => {
    const jwt = googleJwtAssertion(CREDS.key, 1_800_000_000);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid-1' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({
      iss: KEY_JSON.client_email,
      scope: GOOGLE_ADS_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('mints one token (cached) and sends Bearer; developer-token / login-customer-id only when set', async () => {
    const { fn, calls } = mockFetch(() => ({ json: { results: [CAMPAIGN_ROW] } }));
    const c = new GoogleAdsConnector({ fetch: fn, credentials: CREDS });
    await c.search('SELECT customer.id FROM customer');
    await c.search('SELECT customer.id FROM customer');
    const token = calls.filter((x) => x.url.includes('oauth2'));
    expect(token).toHaveLength(1);
    const form = new URLSearchParams(String(token[0].init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')?.split('.')).toHaveLength(3);
    const api = calls.filter((x) => !x.url.includes('oauth2'));
    expect(api[0].url).toBe('https://googleads.googleapis.com/v26/customers/7708137566/googleAds:search');
    expect(api[0].init.method).toBe('POST');
    const headers = api[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ya29.test');
    expect(headers).not.toHaveProperty('developer-token');
    expect(headers).not.toHaveProperty('login-customer-id');

    clearGoogleTokenCache();
    const m2 = mockFetch(() => ({ json: { results: [] } }));
    await new GoogleAdsConnector({ fetch: m2.fn, credentials: { ...CREDS, developerToken: 'devtok', loginCustomerId: '7300585097' } }).search('SELECT customer.id FROM customer');
    const h2 = m2.calls.find((x) => !x.url.includes('oauth2'))!.init.headers as Record<string, string>;
    expect(h2['developer-token']).toBe('devtok');
    expect(h2['login-customer-id']).toBe('7300585097');
  });

  it('token failure surfaces as a ConnectorError', async () => {
    const fn = async () => new Response('{"error":"invalid_grant"}', { status: 400 });
    await expect(new GoogleAdsConnector({ fetch: fn, credentials: CREDS }).fetchEntities()).rejects.toThrow(/Google Ads token: HTTP 400/);
  });
});

describe('Google Ads mapping', () => {
  it('campaign: micros → dollars, App store → android, start in account tz', () => {
    expect(mapGoogleCampaign(CAMPAIGN_ROW)).toMatchObject({
      channel: 'google_ads',
      platform: 'android',
      level: 'campaign',
      externalId: '281499373901203',
      campaignExternalId: '281499373901203',
      name: 'FitCircle Android - US - Installs (test)',
      status: 'ENABLED',
      servingStatus: 'SERVING',
      bidStrategy: 'TARGET_CPA',
      bidAmount: 2.5,
      bidCurrency: 'USD',
      dailyBudget: 15,
      startAt: '2026-10-26T04:00:00.000Z', // midnight EDT
      endAt: null,
    });
    expect(zonedToIso('2026-12-01 00:00:00', 'America/Toronto')).toBe('2026-12-01T05:00:00.000Z'); // EST
  });

  it('daily rows: cost_micros → spend, clicks → taps, installs = biddable_app_install_conversions', () => {
    const rows = mapGoogleDaily([daily('2026-10-26', '12345678', '1000', '40', 6), daily('2026-10-27', '990000', '50', '2', 0)], 'campaign');
    expect(rows).toEqual([
      { channel: 'google_ads', level: 'campaign', externalId: '281499373901203', campaignExternalId: '281499373901203', date: '2026-10-26', spend: 12.35, currency: 'USD', impressions: 1000, taps: 40, installs: 6, newDownloads: 6, redownloads: 0 },
      { channel: 'google_ads', level: 'campaign', externalId: '281499373901203', campaignExternalId: '281499373901203', date: '2026-10-27', spend: 0.99, currency: 'USD', impressions: 50, taps: 2, installs: 0, newDownloads: 0, redownloads: 0 },
    ]);
    // Fractional (modelled) installs round; duplicates of one (entity, day) sum in micros.
    const dup = mapGoogleDaily([{ ...daily('2026-10-26', '5005000', '1', '1', 0), metrics: { costMicros: '5005000', biddableAppInstallConversions: 2.6 } }, daily('2026-10-26', '5005000', '1', '1', 1, true)], 'ad_group');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ level: 'ad_group', externalId: '190000000001', campaignExternalId: '281499373901203', spend: 5.01, installs: 1 });
  });
});

describe('Google Ads connector (mock fetch)', () => {
  it('fetchEntities + fetchDailyMetrics: 4 GAQL searches, all read-only, paginated', async () => {
    const queries: string[] = [];
    const { fn, calls } = mockFetch((_url, body) => {
      queries.push(body.query);
      if (body.query === GAQL_CAMPAIGNS) return { json: { results: [CAMPAIGN_ROW] } };
      if (body.query === GAQL_AD_GROUPS) return { json: { results: [AD_GROUP_ROW] } };
      if (body.query.includes('FROM ad_group WHERE segments.date')) return { json: { results: [daily('2026-10-26', '12345678', '1000', '40', 6, true)] } };
      // campaign daily: two pages
      if (!body.pageToken) return { json: { results: [daily('2026-10-26', '12345678', '1000', '40', 6)], nextPageToken: 'p2' } };
      return { json: { results: [daily('2026-10-27', '2000000', '100', '3', 1)] } };
    });
    const c = new GoogleAdsConnector({ fetch: fn, credentials: CREDS });
    const entities = await c.fetchEntities();
    expect(entities.map((e) => `${e.level}:${e.externalId}:${e.platform}`)).toEqual(['campaign:281499373901203:android', 'ad_group:190000000001:android']);
    expect(entities[1]).toMatchObject({ parentExternalId: '281499373901203', bidStrategy: 'TARGET_CPA' });

    const metrics = await c.fetchDailyMetrics('2026-10-24', '2026-10-27');
    expect(metrics.filter((m) => m.level === 'campaign').map((m) => [m.date, m.spend, m.installs])).toEqual([
      ['2026-10-26', 12.35, 6],
      ['2026-10-27', 2, 1],
    ]);
    expect(metrics.filter((m) => m.level === 'ad_group')).toHaveLength(1);
    expect(queries.some((q) => q.includes("segments.date BETWEEN '2026-10-24' AND '2026-10-27'"))).toBe(true);
    expect(queries.every((q) => /^SELECT /.test(q))).toBe(true);
    for (const call of calls) expect(call.url).not.toMatch(/mutate/i);

    const totals = await c.fetchTotals('2026-10-24', '2026-10-27');
    expect(totals.totals).toEqual({ spend: 14.35, currency: 'USD', impressions: 1100, taps: 43, installs: 7 });
  });

  it('API errors carry the Google error code and message', async () => {
    const { fn } = mockFetch(() => ({
      status: 403,
      json: { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' }, message: "User doesn't have permission to access customer." }] }] } },
    }));
    await expect(new GoogleAdsConnector({ fetch: fn, credentials: CREDS }).fetchEntities()).rejects.toThrow(
      "Google Ads search: HTTP 403 [authorizationError=USER_PERMISSION_DENIED] — User doesn't have permission to access customer."
    );
  });

  it('rejects malformed dates before calling the API; applyChange always throws', async () => {
    const { fn, calls } = mockFetch(() => ({ json: { results: [] } }));
    const c = new GoogleAdsConnector({ fetch: fn, credentials: CREDS });
    await expect(c.fetchDailyMetrics("2026-10-01' OR 1=1", '2026-10-02')).rejects.toThrow(/bad date/);
    await expect(c.applyChange({ channel: 'google_ads', level: 'campaign', externalId: '1', parentExternalId: null, campaignExternalId: '1', field: 'daily_budget', value: 20, currency: 'USD' })).rejects.toThrow(/read-only/);
    expect(calls).toHaveLength(0);
  });
});

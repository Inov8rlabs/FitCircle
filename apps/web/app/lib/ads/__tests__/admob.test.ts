/**
 * AdMob client (lib/ads/admob/client.ts): env parsing, the network report
 * request, stream parsing, and that the client only ever reads.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { AdmobClient, admobCredentialsFromEnv, clearAdmobTokenCache, DEFAULT_ADMOB_PUBLISHER_ID, networkReportBody, parseNetworkReport, platformOf } from '../admob/client';

const CREDS = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shh', refreshToken: '1//refresh-token-value', publisherId: 'pub-1808316612259930' };

const REPORT = [
  { header: { dateRange: { startDate: { year: 2026, month: 10, day: 29 }, endDate: { year: 2026, month: 11, day: 4 } }, localizationSettings: { currencyCode: 'USD', languageCode: 'en-US' } } },
  {
    row: {
      dimensionValues: {
        DATE: { value: '20261103' },
        APP: { value: 'ca-app-pub-1808316612259930~2735230071', displayLabel: 'FitCircle' },
        PLATFORM: { value: 'Android' },
        AD_UNIT: { value: 'ca-app-pub-1808316612259930/1111111111', displayLabel: 'Home native' },
        FORMAT: { value: 'NATIVE' },
        COUNTRY: { value: 'US' },
      },
      metricValues: {
        ESTIMATED_EARNINGS: { microsValue: '153000' },
        AD_REQUESTS: { integerValue: '40' },
        MATCHED_REQUESTS: { integerValue: '30' },
        IMPRESSIONS: { integerValue: '21' },
        CLICKS: { integerValue: '1' },
      },
    },
  },
  {
    row: {
      dimensionValues: {
        DATE: { value: '20261103' },
        APP: { value: 'ca-app-pub-1808316612259930~2129238766', displayLabel: 'FitCircle' },
        PLATFORM: { value: 'iOS' },
        AD_UNIT: { value: 'ca-app-pub-1808316612259930/2222222222', displayLabel: 'Home native iOS' },
        FORMAT: { value: 'NATIVE' },
        COUNTRY: {},
      },
      metricValues: { ESTIMATED_EARNINGS: { microsValue: '9000' }, AD_REQUESTS: { integerValue: '5' }, MATCHED_REQUESTS: { integerValue: '4' }, IMPRESSIONS: { integerValue: '3' }, CLICKS: {} },
    },
  },
  { footer: { matchingRowCount: '2' } },
];

afterEach(() => clearAdmobTokenCache());

describe('admobCredentialsFromEnv', () => {
  it('needs client id, secret and refresh token; defaults the publisher id', () => {
    expect(admobCredentialsFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(admobCredentialsFromEnv({ ADMOB_OAUTH_CLIENT_ID: 'a', ADMOB_OAUTH_CLIENT_SECRET: 'b' } as unknown as NodeJS.ProcessEnv)).toBeNull();
    const c = admobCredentialsFromEnv({ ADMOB_OAUTH_CLIENT_ID: 'a', ADMOB_OAUTH_CLIENT_SECRET: 'b', ADMOB_OAUTH_REFRESH_TOKEN: 'c' } as unknown as NodeJS.ProcessEnv);
    expect(c?.publisherId).toBe(DEFAULT_ADMOB_PUBLISHER_ID);
    expect(admobCredentialsFromEnv({ ADMOB_OAUTH_CLIENT_ID: 'a', ADMOB_OAUTH_CLIENT_SECRET: 'b', ADMOB_OAUTH_REFRESH_TOKEN: 'c', ADMOB_PUBLISHER_ID: 'accounts/pub-1234567890123456' } as unknown as NodeJS.ProcessEnv)?.publisherId).toBe('pub-1234567890123456');
    // A malformed id falls back instead of building a bad URL.
    expect(admobCredentialsFromEnv({ ADMOB_OAUTH_CLIENT_ID: 'a', ADMOB_OAUTH_CLIENT_SECRET: 'b', ADMOB_OAUTH_REFRESH_TOKEN: 'c', ADMOB_PUBLISHER_ID: '../x' } as unknown as NodeJS.ProcessEnv)?.publisherId).toBe(DEFAULT_ADMOB_PUBLISHER_ID);
  });
});

describe('networkReportBody', () => {
  it('asks only additive metrics, Pacific time, USD', () => {
    const b = networkReportBody('2026-10-29', '2026-11-04').reportSpec;
    expect(b.dateRange).toEqual({ startDate: { year: 2026, month: 10, day: 29 }, endDate: { year: 2026, month: 11, day: 4 } });
    expect(b.metrics).toEqual(['ESTIMATED_EARNINGS', 'AD_REQUESTS', 'MATCHED_REQUESTS', 'IMPRESSIONS', 'CLICKS']);
    expect(b.dimensions).toEqual(['DATE', 'APP', 'PLATFORM', 'AD_UNIT', 'FORMAT', 'COUNTRY']);
    expect(b.timeZone).toBe('America/Los_Angeles');
    expect(b.localizationSettings.currencyCode).toBe('USD');
    expect(() => networkReportBody('2026-1-1', '2026-11-04')).toThrow(/bad date/);
  });
});

describe('parseNetworkReport', () => {
  it('maps the header/row/footer stream; micros → dollars; missing country → ZZ', () => {
    const { rows, currency, matchingRowCount } = parseNetworkReport(REPORT);
    expect(currency).toBe('USD');
    expect(matchingRowCount).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: '2026-11-03', platform: 'android', adUnitName: 'Home native', format: 'NATIVE', country: 'US', estimatedEarnings: 0.153, adRequests: 40, matchedRequests: 30, impressions: 21, clicks: 1 });
    expect(rows[1]).toMatchObject({ platform: 'ios', country: 'ZZ', estimatedEarnings: 0.009, clicks: 0 });
  });

  it('sums duplicate keys and tolerates junk', () => {
    const dup = [REPORT[1], REPORT[1], { row: { dimensionValues: { DATE: { value: 'bad' } } } }, {}];
    const { rows } = parseNetworkReport(dup);
    expect(rows).toHaveLength(1);
    expect(rows[0].estimatedEarnings).toBeCloseTo(0.306, 6);
    expect(rows[0].impressions).toBe(42);
    expect(parseNetworkReport(null).rows).toEqual([]);
    expect(platformOf('ANDROID')).toBe('android');
    expect(platformOf('web')).toBe('unknown');
  });
});

describe('AdmobClient', () => {
  const fakeFetch = (calls: Array<{ url: string; init?: RequestInit }>, report: unknown = REPORT, tokenStatus = 200) =>
    (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(tokenStatus === 200 ? JSON.stringify({ access_token: 'ya29.token', expires_in: 3600 }) : JSON.stringify({ error: 'invalid_grant' }), { status: tokenStatus });
      }
      if (url.endsWith('/accounts')) return new Response(JSON.stringify({ account: [{ name: 'accounts/pub-1808316612259930', publisherId: 'pub-1808316612259930', reportingTimeZone: 'America/Los_Angeles', currencyCode: 'USD' }] }));
      return new Response(JSON.stringify(report));
    }) as any;

  it('refresh-token grant, then a read-only report call; token cached', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new AdmobClient({ fetch: fakeFetch(calls), credentials: CREDS });
    expect(client.isConfigured()).toBe(true);
    const report = await client.networkReport('2026-10-29', '2026-11-04');
    await client.listAccounts();
    expect(report.rows).toHaveLength(2);
    const token = calls.filter((c) => c.url.includes('oauth2'));
    expect(token).toHaveLength(1);
    expect(String(token[0].init?.body)).toContain('grant_type=refresh_token');
    const api = calls.filter((c) => c.url.startsWith('https://admob.googleapis.com/'));
    expect(api.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'POST https://admob.googleapis.com/v1/accounts/pub-1808316612259930/networkReport:generate',
      'GET https://admob.googleapis.com/v1/accounts',
    ]);
    expect((api[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer ya29.token');
  });

  it('an expired refresh token says what to do, without echoing secrets', async () => {
    const client = new AdmobClient({ fetch: fakeFetch([], REPORT, 400), credentials: CREDS });
    const err = (await client.networkReport('2026-10-29', '2026-11-04').catch((e) => e)) as Error;
    expect(err.message).toMatch(/invalid_grant/);
    expect(err.message).toMatch(/admob-oauth/);
    expect(err.message).not.toContain(CREDS.refreshToken);
    expect(err.message).not.toContain(CREDS.clientSecret);
  });

  it('API errors surface status and message', async () => {
    const f = (async (url: string) =>
      url.includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }))
        : new Response(JSON.stringify([{ error: { code: 403, message: 'AdMob API has not been used in project 123', status: 'PERMISSION_DENIED' } }]), { status: 403 })) as any;
    const err = (await new AdmobClient({ fetch: f, credentials: CREDS }).networkReport('2026-10-29', '2026-11-04').catch((e) => e)) as Error;
    expect(err.message).toBe('AdMob: HTTP 403 [PERMISSION_DENIED] — AdMob API has not been used in project 123');
  });

  it('not configured → throws before any network call', async () => {
    const calls: Array<{ url: string }> = [];
    const client = new AdmobClient({ fetch: fakeFetch(calls as any), credentials: null });
    expect(client.isConfigured()).toBe(false);
    await expect(client.networkReport('2026-10-29', '2026-11-04')).rejects.toThrow(/not configured/);
    expect(calls).toHaveLength(0);
  });
});

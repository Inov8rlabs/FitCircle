/**
 * GA4 BigQuery export → user_attribution upgrades (docs/ADS_ATTRIBUTION_GA4.md).
 * BigQuery is a mocked fetch; Supabase is the in-memory fake.
 */
import { generateKeyPairSync } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('./fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { GET as cronGET } from '@/api/cron/ads/ga4-attribution/route';

import { parseServiceAccountKey } from '../connectors/google-ads';
import { evidenceOf, ga4AttributionSql, GA4_SOURCE, googleAdsSignals, type Ga4InstanceRow, planChange } from '../ga4/attribution';
import { BigQueryClient, clearBigQueryTokenCache, decodeRows, ga4BigQueryConfigFromEnv, type Ga4BigQueryConfig } from '../ga4/bigquery';
import { Ga4AttributionService } from '../services/ga4-attribution-service';
import type { AttributionRow } from '../types';

import { AdsFakeDb, setAdsDb } from './fake-db';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({ private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), client_email: 'google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com' });
const CONFIG: Ga4BigQueryConfig = { key: parseServiceAccountKey(KEY_JSON)!, projectId: 'fitcircle-fitness-app', dataset: 'analytics_553928425', location: null, androidAppId: 'com.inov8rlabs.apps.fitcircle' };

const U1 = '11111111-1111-4111-8111-111111111111'; // organic (google-play) → upgraded via GA4 user_id
const U2 = '22222222-2222-4222-8222-222222222222'; // unknown, matched by app_instance_id
const U3 = '33333333-3333-4333-8333-333333333333'; // already apple_ads → never touched
const U4 = '44444444-4444-4444-8444-444444444444'; // no attribution row → inserted
const U5 = '55555555-5555-4555-8555-555555555555'; // GA4 user_id but no profile
const U6 = '66666666-6666-4666-8666-666666666666'; // organic in GA4 too → not Google

const FIELDS = [
  'user_pseudo_id', 'user_id', 'first_open_micros', 'sign_up_micros', 'first_user_source', 'first_user_medium', 'first_user_campaign', 'manual_source', 'manual_medium', 'has_gclid',
  'gads_customer_id', 'gads_campaign_id', 'gads_campaign_name', 'gads_ad_group_id', 'gads_ad_group_name',
] as const;
const inst = (o: Partial<Ga4InstanceRow>): Ga4InstanceRow => ({ ...Object.fromEntries(FIELDS.map((f) => [f, null])), first_open_micros: '1761750000000000', ...o }) as Ga4InstanceRow;
const bqRow = (r: Ga4InstanceRow) => ({ f: FIELDS.map((f) => ({ v: r[f] })) });
const SCHEMA = { fields: FIELDS.map((name) => ({ name, type: 'STRING' })) };

const INSTANCES: Ga4InstanceRow[] = [
  inst({ user_pseudo_id: 'p1', user_id: U1, first_user_source: 'google', first_user_medium: 'cpc', first_user_campaign: 'FitCircle Android - US - Installs (test)', gads_campaign_id: '24397202136', gads_ad_group_id: '190000000001', sign_up_micros: '1761750600000000' }),
  inst({ user_pseudo_id: 'p2', first_user_source: 'google', first_user_medium: 'cpc', first_user_campaign: 'FitCircle Android - US - Installs (test)' }),
  inst({ user_pseudo_id: 'p3', user_id: U3, gads_campaign_id: '24397202136' }),
  inst({ user_pseudo_id: 'p4', user_id: U4, has_gclid: 'true' }),
  inst({ user_pseudo_id: 'p5', user_id: U5, first_user_source: 'google', first_user_medium: 'cpc' }),
  inst({ user_pseudo_id: 'p6', user_id: U6, first_user_source: 'google-play', first_user_medium: 'organic' }),
  inst({ user_pseudo_id: 'p7', first_user_source: 'google', first_user_medium: 'cpc' }), // Google but never tied to a user
];

const attr = (user_id: string, channel: AttributionRow['channel'], source: string, extra: Partial<AttributionRow> = {}): AttributionRow => ({
  user_id,
  channel,
  platform: 'android',
  source,
  campaign_external_id: null,
  ad_group_external_id: null,
  keyword_external_id: null,
  ad_external_id: null,
  click_at: null,
  country: 'US',
  is_test: false,
  raw: { utm_source: 'google-play', utm_medium: 'organic' },
  reported_at: '2026-10-29T10:00:00Z',
  ...extra,
});

function bigQueryFetch(instances = INSTANCES, opts: { pending?: boolean; pages?: boolean } = {}) {
  const calls: Array<{ url: string; body: any; method: string }> = [];
  const fn = async (url: string, init: RequestInit = {}) => {
    const body = init.body && String(init.body).startsWith('{') ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, method: init.method ?? 'GET' });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'bq-token', expires_in: 3599 }), { status: 200 });
    const half = Math.ceil(instances.length / 2);
    if (init.method === 'POST') {
      if (opts.pending) return new Response(JSON.stringify({ jobComplete: false, jobReference: { jobId: 'job_1', location: 'US' } }), { status: 200 });
      return new Response(JSON.stringify({ jobComplete: true, jobReference: { jobId: 'job_1', location: 'US' }, schema: SCHEMA, rows: (opts.pages ? instances.slice(0, half) : instances).map(bqRow), ...(opts.pages ? { pageToken: 'pg2' } : {}) }), { status: 200 });
    }
    if (url.includes('pageToken=pg2')) return new Response(JSON.stringify({ jobComplete: true, schema: SCHEMA, rows: instances.slice(half).map(bqRow) }), { status: 200 });
    return new Response(JSON.stringify({ jobComplete: true, jobReference: { jobId: 'job_1', location: 'US' }, schema: SCHEMA, rows: instances.map(bqRow) }), { status: 200 });
  };
  return { fn, calls };
}

let db: AdsFakeDb;
function seed() {
  db = new AdsFakeDb();
  setAdsDb(db);
  for (const id of [U1, U2, U3, U4, U6]) db.rows('profiles').push({ id, created_at: '2026-10-29T10:00:00Z', email: `${id}@example.com` });
  db.rows('user_attribution').push(
    attr(U1, 'organic', 'google-play'),
    attr(U2, 'unknown', 'something', { app_instance_id: 'p2' }),
    attr(U3, 'apple_ads', 'apple_search_ads', { platform: 'ios', campaign_external_id: '2144950391' }),
    attr(U6, 'organic', 'google-play')
  );
  db.rows('ad_entities').push({ channel: 'google_ads', level: 'campaign', external_id: '24397202136', name: 'FitCircle Android - US - Installs (test)' });
}

const NOW = new Date('2026-10-31T10:00:00Z');
const runWith = (fetchFn: any, extra: Parameters<typeof Ga4AttributionService.run>[0] = {}) =>
  Ga4AttributionService.run({ now: NOW, force: true, config: CONFIG, client: new BigQueryClient(CONFIG, { fetch: fetchFn }), ...extra });

beforeEach(() => {
  clearBigQueryTokenCache();
  seed();
});
afterEach(() => vi.unstubAllEnvs());

describe('GA4 export query', () => {
  it('daily tables only, Android prod app, first_open / sign_up / identified session_start, parameters for every value', () => {
    const sql = ga4AttributionSql('fitcircle-fitness-app', 'analytics_553928425');
    expect(sql).toContain('FROM `fitcircle-fitness-app.analytics_553928425.events_*`');
    expect(sql).toContain('_TABLE_SUFFIX BETWEEN @start AND @end');
    expect(sql).toContain('app_info.id = @app_id');
    expect(sql).toContain("platform = 'ANDROID'");
    expect(sql).toContain('traffic_source.source');
    expect(sql).toContain('session_traffic_source_last_click.google_ads_campaign.campaign_id');
    expect(sql).toContain('LOGICAL_OR(collected_traffic_source.gclid IS NOT NULL)');
    expect(sql).not.toMatch(/SELECT[\s\S]*collected_traffic_source\.gclid,/); // the click id itself is never read out
  });

  it('config: skips cleanly when unset or malformed; falls back to GOOGLE_ADS_SA_KEY', () => {
    expect(ga4BigQueryConfigFromEnv({} as any)).toBeNull();
    expect(ga4BigQueryConfigFromEnv({ GA4_BIGQUERY_PROJECT_ID: 'fitcircle-fitness-app', GA4_BIGQUERY_DATASET: 'analytics_553928425' } as any)).toBeNull();
    expect(ga4BigQueryConfigFromEnv({ GA4_BIGQUERY_PROJECT_ID: 'x`; DROP', GA4_BIGQUERY_DATASET: 'analytics_1', GOOGLE_ADS_SA_KEY: KEY_JSON } as any)).toBeNull();
    expect(ga4BigQueryConfigFromEnv({ GA4_BIGQUERY_PROJECT_ID: 'fitcircle-fitness-app', GA4_BIGQUERY_DATASET: 'analytics_5539.x', GOOGLE_ADS_SA_KEY: KEY_JSON } as any)).toBeNull();
    const c = ga4BigQueryConfigFromEnv({ GA4_BIGQUERY_PROJECT_ID: 'fitcircle-fitness-app', GA4_BIGQUERY_DATASET: 'analytics_553928425', GOOGLE_ADS_SA_KEY: KEY_JSON } as any);
    expect(c).toMatchObject({ projectId: 'fitcircle-fitness-app', dataset: 'analytics_553928425', androidAppId: 'com.inov8rlabs.apps.fitcircle', location: null });
  });

  it('decodeRows maps {f:[{v}]} by schema field name', () => {
    expect(decodeRows({ fields: [{ name: 'a' }, { name: 'b' }] }, [{ f: [{ v: '1' }, { v: null }] }])).toEqual([{ a: '1', b: null }]);
  });

  it('client: JWT token, named parameters, polls an unfinished job and follows pageToken', async () => {
    const pending = bigQueryFetch(INSTANCES, { pending: true });
    const rows = await new BigQueryClient(CONFIG, { fetch: pending.fn as any }).query('SELECT 1', [{ name: 'start', value: '20261024' }]);
    expect(rows).toHaveLength(INSTANCES.length);
    const post = pending.calls.find((c) => c.method === 'POST' && c.url.includes('/queries'))!;
    expect(post.url).toBe('https://bigquery.googleapis.com/bigquery/v2/projects/fitcircle-fitness-app/queries');
    expect(post.body).toMatchObject({ useLegacySql: false, parameterMode: 'NAMED', queryParameters: [{ name: 'start', parameterType: { type: 'STRING' }, parameterValue: { value: '20261024' } }] });
    expect(pending.calls.some((c) => c.method === 'GET' && c.url.includes('/queries/job_1?') && c.url.includes('location=US'))).toBe(true);

    clearBigQueryTokenCache();
    const paged = bigQueryFetch(INSTANCES, { pages: true });
    expect(await new BigQueryClient(CONFIG, { fetch: paged.fn as any }).query('SELECT 1')).toHaveLength(INSTANCES.length);
  });

  it('client: HTTP errors carry the BigQuery reason', async () => {
    const fn = async (url: string) =>
      url.includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 't', expires_in: 3599 }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: 'Not found: Dataset fitcircle-fitness-app:analytics_553928425', errors: [{ reason: 'notFound' }] } }), { status: 404 });
    await expect(new BigQueryClient(CONFIG, { fetch: fn as any }).query('SELECT 1')).rejects.toThrow(/HTTP 404 \[notFound\].*analytics_553928425/);
  });
});

describe('Google Ads evidence + plan', () => {
  it('signals: Google Ads campaign, gclid, google/cpc first-user; organic is none', () => {
    expect(googleAdsSignals(INSTANCES[0])).toEqual(['google_ads_campaign', 'first_user_cpc']);
    expect(googleAdsSignals(INSTANCES[3])).toEqual(['gclid']);
    expect(googleAdsSignals(INSTANCES[5])).toEqual([]);
  });

  it('never downgrades a paid row; resolves campaign id by name when the export has only a name', () => {
    const ev = evidenceOf(INSTANCES[1], 'app_instance_id');
    const names = new Map([['fitcircle android - us - installs (test)', '24397202136']]);
    expect(planChange(U3, attr(U3, 'meta', 'meta'), true, ev, names, 'now').outcome).toBe('already_paid');
    expect(planChange(U3, attr(U3, 'organic', 'x', { is_test: true }), true, ev, names, 'now').outcome).toBe('test');
    expect(planChange(U5, null, false, ev, names, 'now').outcome).toBe('no_profile');
    const p = planChange(U2, attr(U2, 'unknown', 'something'), true, ev, names, 'now');
    expect(p).toMatchObject({ outcome: 'upgrade', row: { channel: 'google_ads', source: GA4_SOURCE, campaign_external_id: '24397202136' } });
  });
});

describe('Ga4AttributionService.run', () => {
  it('upgrades organic/unknown, inserts missing, never touches paid; evidence kept in raw', async () => {
    const { fn, calls } = bigQueryFetch();
    const r = await runWith(fn);
    expect(r).toMatchObject({ skipped: null, range: { start: '2026-10-24', end: '2026-10-30' }, instances: 7, googleInstances: 6, matched: 5, upgraded: 2, inserted: 1, error: null });
    expect(r.outcomes).toEqual({ unmatched: 1, already_paid: 1, no_profile: 1, upgrade: 2, insert: 1 });
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/queries'))!;
    expect(post.body.queryParameters.map((p: any) => [p.name, p.parameterValue.value])).toEqual([
      ['start', '20261024'],
      ['end', '20261030'],
      ['app_id', 'com.inov8rlabs.apps.fitcircle'],
    ]);

    const row = (id: string) => db.rows('user_attribution').find((a) => a.user_id === id)!;
    expect(row(U1)).toMatchObject({ channel: 'google_ads', source: GA4_SOURCE, campaign_external_id: '24397202136', ad_group_external_id: '190000000001', country: 'US', reported_at: '2026-10-29T10:00:00Z' });
    expect(row(U1).raw.ga4).toMatchObject({ userPseudoId: 'p1', matchedBy: 'user_id', signals: ['google_ads_campaign', 'first_user_cpc'], signUpAt: '2025-10-29T15:10:00.000Z' });
    expect(row(U1).raw.previous).toMatchObject({ channel: 'organic', source: 'google-play', raw: { utm_medium: 'organic' } });
    expect(row(U2)).toMatchObject({ channel: 'google_ads', source: GA4_SOURCE, campaign_external_id: '24397202136', app_instance_id: 'p2' });
    expect(row(U2).raw.ga4.matchedBy).toBe('app_instance_id');
    expect(row(U3)).toMatchObject({ channel: 'apple_ads', source: 'apple_search_ads' });
    expect(row(U4)).toMatchObject({ channel: 'google_ads', source: GA4_SOURCE, platform: 'android', app_instance_id: 'p4', campaign_external_id: null });
    expect(row(U6)).toMatchObject({ channel: 'organic' });
    expect(db.rows('user_attribution').some((a) => a.user_id === U5)).toBe(false);
  });

  it('is idempotent: a second run changes nothing', async () => {
    await runWith(bigQueryFetch().fn);
    const before = JSON.stringify(db.rows('user_attribution'));
    const r = await runWith(bigQueryFetch().fn);
    expect(r).toMatchObject({ upgraded: 0, inserted: 0 });
    expect(r.outcomes).toMatchObject({ already_ga4: 3, already_paid: 1 });
    expect(JSON.stringify(db.rows('user_attribution'))).toBe(before);
  });

  it('dry run counts without writing', async () => {
    const before = JSON.stringify(db.rows('user_attribution'));
    const r = await runWith(bigQueryFetch().fn, { dryRun: true });
    expect(r).toMatchObject({ dryRun: true, upgraded: 2, inserted: 1 });
    expect(JSON.stringify(db.rows('user_attribution'))).toBe(before);
  });

  it('a paid attribution written between plan and write is not replaced (guarded update)', async () => {
    const { fn } = bigQueryFetch([INSTANCES[0]]);
    const client = new BigQueryClient(CONFIG, { fetch: fn as any });
    // Another writer sets U1 to meta after the plan was made (just before our update runs).
    const realClient = db.client.bind(db);
    db.client = () => {
      const c = realClient();
      return {
        from: (t: string) => {
          const q: any = c.from(t);
          const update = q.update.bind(q);
          q.update = (patch: any) => {
            db.rows('user_attribution').find((a) => a.user_id === U1)!.channel = 'meta';
            return update(patch);
          };
          return q;
        },
      };
    };
    const r = await Ga4AttributionService.run({ now: NOW, force: true, config: CONFIG, client });
    expect(r.outcomes).toMatchObject({ lost_race: 1 });
    expect(db.rows('user_attribution').find((a) => a.user_id === U1)).toMatchObject({ channel: 'meta', source: 'google-play' });
  });

  it('kill switch off by default; not configured without BigQuery env', async () => {
    vi.stubEnv('GA4_ATTRIBUTION_SYNC_ENABLED', '');
    expect(await Ga4AttributionService.run({ now: NOW })).toMatchObject({ skipped: 'disabled', instances: 0 });
    vi.stubEnv('GA4_ATTRIBUTION_SYNC_ENABLED', 'true');
    vi.stubEnv('GA4_BIGQUERY_PROJECT_ID', '');
    expect(await Ga4AttributionService.run({ now: NOW })).toMatchObject({ skipped: 'not_configured' });
  });

  it('lookback from env, capped', async () => {
    vi.stubEnv('GA4_ATTRIBUTION_LOOKBACK_DAYS', '3');
    expect((await runWith(bigQueryFetch([]).fn)).range).toEqual({ start: '2026-10-28', end: '2026-10-30' });
    vi.stubEnv('GA4_ATTRIBUTION_LOOKBACK_DAYS', '999');
    expect((await runWith(bigQueryFetch([]).fn)).range).toEqual({ start: '2026-09-01', end: '2026-10-30' });
  });
});

describe('GET /api/cron/ads/ga4-attribution', () => {
  const get = (qs = '', auth: string | null = 'Bearer cron-s') =>
    cronGET(new NextRequest(`https://www.fitcircle.ai/api/cron/ads/ga4-attribution${qs}`, { headers: auth ? { authorization: auth } : {} }));

  it('401 without the cron secret; disabled by default', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-s');
    expect((await get('', null)).status).toBe(401);
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ skipped: 'disabled' });
  });

  it('backfill range needs the admin secret; bad dates → 400', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-s');
    vi.stubEnv('ADMIN_API_SECRET', 'admin-s');
    expect((await get('?start=2026-10-01&end=2026-10-07')).status).toBe(401);
    expect((await get('?start=2026-10-07&end=2026-10-01', 'Bearer admin-s')).status).toBe(400);
    vi.stubEnv('GA4_ATTRIBUTION_SYNC_ENABLED', 'true');
    const res = await get('?start=2026-10-01&end=2026-10-07', 'Bearer admin-s');
    expect((await res.json()).data).toMatchObject({ skipped: 'not_configured' });
  });
});

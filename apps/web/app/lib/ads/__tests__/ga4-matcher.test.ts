/**
 * GA4 fallback matcher (time + geo + device, 1:1) and the backfill / review
 * flow built on it (docs/ADS_ATTRIBUTION_GA4.md §8). BigQuery is a mocked
 * fetch; Supabase is the in-memory fake.
 */
import { generateKeyPairSync } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('./fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { GET as previewGET, POST as applyPOST } from '@/api/admin/ads/ga4-attribution/route';

import { attributionFromBody } from '../attribution';
import { parseServiceAccountKey } from '../connectors/google-ads';
import type { Ga4InstanceRow } from '../ga4/attribution';
import { BigQueryClient, clearBigQueryTokenCache, type Ga4BigQueryConfig } from '../ga4/bigquery';
import { countryKey, ga4CountryToIso2, timezoneCountry } from '../ga4/countries';
import { countryAgreement, deviceAgreement, deviceKeys, matchInstances, MAX_DELTA_S, type MatchInstance, type MatchUser, scorePair } from '../ga4/matcher';
import { Ga4AttributionService } from '../services/ga4-attribution-service';
import type { AttributionRow } from '../types';

import { AdsFakeDb, setAdsDb } from './fake-db';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({ private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), client_email: 'google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com' });
const CONFIG: Ga4BigQueryConfig = { key: parseServiceAccountKey(KEY_JSON)!, projectId: 'fitcircle-fitness-app', dataset: 'analytics_553928425', location: null, androidAppId: 'com.inov8rlabs.apps.fitcircle' };

// ---------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------

describe('country mapping', () => {
  it('GA4 display names → ISO2, incl. GA4 / CLDR spelling differences', () => {
    expect(ga4CountryToIso2('United States')).toBe('US');
    expect(ga4CountryToIso2('U.S. Virgin Islands')).toBe('VI');
    expect(ga4CountryToIso2('India')).toBe('IN');
    expect(ga4CountryToIso2('United Kingdom')).toBe('GB');
    expect(ga4CountryToIso2('Türkiye')).toBe('TR');
    expect(ga4CountryToIso2('Turkey')).toBe('TR');
    expect(ga4CountryToIso2('Czechia')).toBe('CZ');
    expect(ga4CountryToIso2('Czech Republic')).toBe('CZ');
    expect(ga4CountryToIso2('Hong Kong')).toBe('HK');
    expect(ga4CountryToIso2('Côte d’Ivoire')).toBe('CI');
    expect(ga4CountryToIso2('Myanmar (Burma)')).toBe('MM');
    expect(ga4CountryToIso2('Bosnia & Herzegovina')).toBe('BA');
    expect(ga4CountryToIso2('South Korea')).toBe('KR');
    expect(ga4CountryToIso2('Puerto Rico')).toBe('PR');
    expect(ga4CountryToIso2('US')).toBe('US');
    expect(ga4CountryToIso2('(not set)')).toBeNull();
    expect(ga4CountryToIso2('Atlantis')).toBeNull();
    expect(ga4CountryToIso2(null)).toBeNull();
    expect(countryKey('São Tomé & Príncipe')).toBe('saotomeandprincipe');
  });

  it('time zones name one country only when unambiguous; UTC is no signal', () => {
    expect(timezoneCountry('America/St_Thomas')).toBe('VI');
    expect(timezoneCountry('America/Chicago')).toBe('US');
    expect(timezoneCountry('Asia/Kolkata')).toBe('IN');
    expect(timezoneCountry('UTC')).toBeNull();
    expect(timezoneCountry(null)).toBeNull();
  });
});

describe('device comparison', () => {
  it('push-token "<manufacturer> <model>" vs GA4 hardware model / model name', () => {
    expect(deviceAgreement(['SM-S916U1'], ['samsung SM-S916U1'])).toBe('match');
    expect(deviceAgreement(['moto g - 2025', 'Moto G (2025)'], ['motorola moto g - 2025'])).toBe('match');
    expect(deviceAgreement(['Pixel 9'], ['Google Pixel 9'])).toBe('match');
    expect(deviceAgreement(['SM-A136U1'], ['Google Pixel 7'])).toBe('mismatch');
    expect(deviceAgreement([], ['samsung SM-S916U1'])).toBe('unknown');
    expect(deviceAgreement(['SM-S916U1'], [])).toBe('unknown');
    // GA4 strings are compared whole: "Galaxy S23" must not reduce to "s23".
    expect(deviceKeys('Galaxy S23')).toEqual(['galaxys23']);
    expect(deviceKeys('samsung SM-S916U1', true)).toEqual(['samsungsms916u1', 'sms916u1']);
  });

  it('country agreement: any of our signals may agree; all disagreeing is a conflict', () => {
    expect(countryAgreement('US', [{ source: 'timezone', value: 'CA' }, { source: 'experiment_assignment', value: 'US' }])).toBe('match');
    expect(countryAgreement('US', [{ source: 'experiment_assignment', value: 'IN' }])).toBe('mismatch');
    expect(countryAgreement(null, [{ source: 'x', value: 'US' }])).toBe('unknown');
    expect(countryAgreement('US', [])).toBe('unknown');
  });
});

const T0 = Date.parse('2026-11-07T22:04:14Z');
const mi = (o: Partial<MatchInstance> & { pseudoId: string }): MatchInstance => ({ firstOpenMs: T0, countryIso: 'US', countryName: 'United States', region: null, devices: ['SM-S916U1'], brand: 'Samsung', ...o });
const mu = (o: Partial<MatchUser> & { userId: string }): MatchUser => ({ firstSeenMs: T0 + 78_000, countries: [{ source: 'experiment_assignment', value: 'US' }], devices: ['samsung SM-S916U1'], isTest: false, ...o });

describe('scorePair', () => {
  it('window: -2 min … +45 min after first open', () => {
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', firstSeenMs: T0 - 121_000 }))).toBeNull();
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', firstSeenMs: T0 - 60_000 }))).not.toBeNull();
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', firstSeenMs: T0 + MAX_DELTA_S * 1000 }))).not.toBeNull();
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', firstSeenMs: T0 + MAX_DELTA_S * 1000 + 1000 }))).toBeNull();
  });

  it('confidence: device+country ≤15 min high; device only / later medium; country only low; conflicts or no evidence rejected', () => {
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u' }))).toMatchObject({ confidence: 'high', evidence: { deltaSeconds: 78, country: 'match', device: 'match', fieldsUsed: ['time', 'country', 'device'] } });
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', firstSeenMs: T0 + 20 * 60_000 }))?.confidence).toBe('medium');
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', countries: [] }))?.confidence).toBe('medium');
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', devices: [] }))?.confidence).toBe('low');
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', devices: ['Google Pixel 9'] }))).toBeNull();
    expect(scorePair(mi({ pseudoId: 'a' }), mu({ userId: 'u', countries: [{ source: 'experiment_assignment', value: 'IN' }] }))).toBeNull();
    expect(scorePair(mi({ pseudoId: 'a', countryIso: null }), mu({ userId: 'u', devices: [] }))).toBeNull();
    expect(scorePair(mi({ pseudoId: 'a', firstOpenMs: null }), mu({ userId: 'u' }))).toBeNull();
  });
});

describe('matchInstances (1:1 only)', () => {
  it('accepts a unique pair', () => {
    const r = matchInstances([mi({ pseudoId: 'a' })], [mu({ userId: 'u1' })]);
    expect(r.matches).toEqual([expect.objectContaining({ pseudoId: 'a', userId: 'u1', confidence: 'high' })]);
    expect(r.unmatched).toEqual([]);
  });

  it('two compatible users for one install → ambiguous, nothing matched', () => {
    const r = matchInstances([mi({ pseudoId: 'a' })], [mu({ userId: 'u1' }), mu({ userId: 'u2', firstSeenMs: T0 + 300_000 })]);
    expect(r.matches).toEqual([]);
    expect(r.unmatched).toEqual([expect.objectContaining({ pseudoId: 'a', reason: 'ambiguous_instance' })]);
    expect(r.unmatched[0].candidates.map((c) => c.userId)).toEqual(['u1', 'u2']);
  });

  it('two installs compatible with one user (reinstall / second phone) → ambiguous for both', () => {
    const r = matchInstances([mi({ pseudoId: 'a' }), mi({ pseudoId: 'b', firstOpenMs: T0 + 30_000 })], [mu({ userId: 'u1' })]);
    expect(r.matches).toEqual([]);
    expect(r.unmatched.map((u) => [u.pseudoId, u.reason])).toEqual([
      ['a', 'ambiguous_user'],
      ['b', 'ambiguous_user'],
    ]);
  });

  it('a test user nearby still makes the match ambiguous (never guessed around)', () => {
    const r = matchInstances([mi({ pseudoId: 'a' })], [mu({ userId: 'real' }), mu({ userId: 'qa', isTest: true })]);
    expect(r.matches).toEqual([]);
  });

  it('a different device at the same minute does not collide', () => {
    const r = matchInstances([mi({ pseudoId: 'a' }), mi({ pseudoId: 'b', devices: ['Pixel 9'] })], [mu({ userId: 'u1' }), mu({ userId: 'u2', devices: ['Google Pixel 9'] })]);
    expect(r.matches.map((m) => [m.pseudoId, m.userId])).toEqual([
      ['a', 'u1'],
      ['b', 'u2'],
    ]);
  });
});

describe('attribution ingest', () => {
  it('Play referrer gad_campaignid fills campaign_external_id on google_ads rows', () => {
    const row = attributionFromBody('u', { platform: 'android', source: 'google_ads', raw: { has_gclid: 'true', gad_campaignid: '24397202136' } } as any);
    expect(row).toMatchObject({ channel: 'google_ads', campaign_external_id: '24397202136' });
    const organic = attributionFromBody('u', { platform: 'android', source: 'google-play', raw: { utm_medium: 'organic', gad_campaignid: '24397202136' } } as any);
    expect(organic.campaign_external_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service + admin routes
// ---------------------------------------------------------------------------

const FIELDS = [
  'user_pseudo_id', 'user_id', 'first_open_micros', 'first_touch_micros', 'first_event_micros', 'sign_up_micros', 'first_user_source', 'first_user_medium', 'first_user_campaign', 'manual_source', 'manual_medium', 'has_gclid',
  'gads_customer_id', 'gads_campaign_id', 'gads_campaign_name', 'gads_ad_group_id', 'gads_ad_group_name',
  'geo_country', 'geo_region', 'geo_city', 'device_brand', 'device_model', 'device_marketing_name', 'device_hardware_model', 'app_version',
] as const;
const micros = (msv: number) => String(msv * 1000);
const inst = (o: Partial<Ga4InstanceRow> & { at: number }): Ga4InstanceRow => {
  const { at, ...rest } = o;
  return { ...Object.fromEntries(FIELDS.map((f) => [f, null])), first_open_micros: micros(at), first_touch_micros: micros(at), geo_country: 'United States', ...rest } as Ga4InstanceRow;
};
const CAMPAIGN = { first_user_source: 'google', first_user_medium: 'cpc', first_user_campaign: 'FitCircle Android - US - Installs (test)', gads_campaign_id: '24397202136', gads_campaign_name: 'FitCircle Android - US - Installs (test)' };

const H = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-aaaa-4aaa-8aaa-${String(n).repeat(12)}`;
const HU1 = H(1); // organic (VI, SM-S916U1) → upgrade, high
const HU2 = H(2); // google_ads, no campaign (moto g 2025) → enrich + ad group by name
const HU3 = H(3); // Pixel 9, two installs a minute apart → ambiguous
const HU4 = H(4); // device conflict → no match
const HU5 = H(5); // Firebase Test Lab account → test, never written
const HU6 = H(6); // no push token, country only → low
const HU7 = H(7); // google_ads with campaign already (manual) → done
const RU1 = H(8); // old google_ads row with gad_campaignid in raw → enrich (exact)
const RU2 = H(9); // old google_ads row, gclid only → sole campaign (low)

const T = (min: number) => T0 + min * 60_000;
const INSTANCES: Ga4InstanceRow[] = [
  inst({ at: T(0), user_pseudo_id: 'g1', ...CAMPAIGN, gads_ad_group_name: 'Ad group 1', geo_country: 'U.S. Virgin Islands', geo_region: 'St. Croix', device_hardware_model: 'SM-S916U1', device_model: 'SM-S916U1' }),
  inst({ at: T(30), user_pseudo_id: 'g2', ...CAMPAIGN, gads_ad_group_name: 'Friends & circles', device_hardware_model: 'moto g - 2025', device_model: 'Moto G (2025)' }),
  inst({ at: T(60), user_pseudo_id: 'g3', ...CAMPAIGN, device_model: 'Pixel 9' }),
  inst({ at: T(61), user_pseudo_id: 'g3b', ...CAMPAIGN, device_model: 'Pixel 9' }),
  inst({ at: T(120), user_pseudo_id: 'g4', ...CAMPAIGN, device_model: 'SM-A136U1' }),
  inst({ at: T(180), user_pseudo_id: 'g5', ...CAMPAIGN, device_model: 'TMRV085G' }),
  inst({ at: T(240), user_pseudo_id: 'g6', ...CAMPAIGN, geo_country: 'India', device_model: 'CPH2835' }),
  inst({ at: T(300), user_pseudo_id: 'g7', ...CAMPAIGN, device_model: 'TCL T513V' }),
  inst({ at: T(400), user_pseudo_id: 'o1', first_user_source: 'google-play', first_user_medium: 'organic', device_model: 'SM-G990U' }), // organic install, nobody signs up
];

function bigQueryFetch(instances = INSTANCES) {
  return async (url: string, init: RequestInit = {}) => {
    const body = init.body && String(init.body).startsWith('{') ? JSON.parse(String(init.body)) : null;
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'bq', expires_in: 3599 }), { status: 200 });
    if (body?.query?.includes('INFORMATION_SCHEMA')) {
      return new Response(JSON.stringify({ jobComplete: true, jobReference: { jobId: 't' }, schema: { fields: [{ name: 'first_table' }, { name: 'last_table' }, { name: 'tables' }] }, rows: [{ f: [{ v: 'events_20261105' }, { v: 'events_20261107' }, { v: '3' }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ jobComplete: true, jobReference: { jobId: 'q' }, schema: { fields: FIELDS.map((name) => ({ name })) }, rows: instances.map((r) => ({ f: FIELDS.map((f) => ({ v: r[f] ?? null })) })) }), { status: 200 });
  };
}

const iso = (msv: number) => new Date(msv).toISOString();
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
  country: null,
  is_test: false,
  raw: { utm_source: 'google-play', utm_medium: 'organic' },
  ...extra,
});

let db: AdsFakeDb;
function user(id: string, signUpAt: number, o: { email?: string; device?: string | null; country?: string | null; tz?: string; attribution?: Partial<AttributionRow> | null } = {}) {
  db.rows('profiles').push({ id, created_at: iso(signUpAt), email: o.email ?? `${id.slice(0, 4)}@realmail.net`, is_admin: false, metadata: {}, country_code: null, timezone: o.tz ?? 'UTC' });
  if (o.attribution !== null) db.rows('user_attribution').push(attr(id, 'organic', 'google-play', { reported_at: iso(signUpAt + 1000), ...(o.attribution ?? {}) }));
  if (o.device !== null) db.rows('push_tokens').push({ id: `pt-${id}`, user_id: id, platform: 'android', device_name: o.device ?? 'samsung SM-S916U1', created_at: iso(signUpAt + 900) });
  if (o.country !== null) db.rows('experiment_assignments').push({ user_id: id, experiment_key: 'onboarding_v2', platform: 'android', country: o.country ?? 'US', assigned_at: iso(signUpAt + 20_000) });
}

function seed() {
  db = new AdsFakeDb();
  setAdsDb(db);
  db.rows('ad_entities').push(
    { channel: 'google_ads', level: 'campaign', external_id: '24397202136', parent_external_id: null, name: 'FitCircle Android - US - Installs (test)', platform: 'android', start_at: '2026-10-20T00:00:00Z' },
    { channel: 'google_ads', level: 'ad_group', external_id: '198779157982', parent_external_id: '24397202136', name: 'Ad group 1', platform: 'android', start_at: null },
    { channel: 'google_ads', level: 'ad_group', external_id: '204681147547', parent_external_id: '24397202136', name: 'Friends & circles', platform: 'android', start_at: null }
  );
  user(HU1, T(0) + 77_000, { country: 'VI', tz: 'America/St_Thomas' });
  user(HU2, T(35), { device: 'motorola moto g - 2025', attribution: { channel: 'google_ads', source: 'google_ads', raw: { has_gclid: 'true', gad_source: '1' } } });
  user(HU3, T(62), { device: 'Google Pixel 9' });
  user(HU4, T(121), { device: 'Google Pixel 7' });
  user(HU5, T(181), { device: 'Luxshare TMRV085G', email: 'robot@cloudtestlabaccounts.com' });
  user(HU6, T(242), { device: null, country: 'IN' });
  user(HU7, T(301), { device: 'TCL T513V', attribution: { channel: 'google_ads', source: 'google_ads', campaign_external_id: '24397202136', raw: { ga4: { matched_by: 'manual' } } } });
  user(RU1, Date.parse('2026-10-25T10:00:00Z'), { attribution: { channel: 'google_ads', source: 'google_ads', raw: { has_gclid: 'true', gad_campaignid: '24397202136' } } });
  user(RU2, Date.parse('2026-10-26T10:00:00Z'), { attribution: { channel: 'google_ads', source: 'google_ads', raw: { has_gclid: 'true', gad_source: '5' } } });
}

const NOW = new Date('2026-11-08T12:00:00Z');
const RANGE = { start: '2026-11-07', end: '2026-11-07' };
const run = (extra: Parameters<typeof Ga4AttributionService.run>[0] = {}) =>
  Ga4AttributionService.run({ now: NOW, force: true, config: CONFIG, client: new BigQueryClient(CONFIG, { fetch: bigQueryFetch() as any }), ...RANGE, ...extra });
const row = (id: string) => db.rows('user_attribution').find((a) => a.user_id === id)!;

beforeEach(() => {
  clearBigQueryTokenCache();
  seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Ga4AttributionService fallback + enrichment', () => {
  it('dry run: per-user preview with evidence; nothing written', async () => {
    const before = JSON.stringify(db.rows('user_attribution'));
    const r = await run({ dryRun: true });
    expect(JSON.stringify(db.rows('user_attribution'))).toBe(before);
    expect(r).toMatchObject({ dryRun: true, exactMatched: 0, minConfidence: 'medium' });
    const by = new Map(r.preview.map((p) => [p.userId, p]));

    expect(by.get(HU1)).toMatchObject({
      outcome: 'upgrade',
      method: 'heuristic_time_geo_device',
      confidence: 'high',
      status: 'would_apply',
      current: { channel: 'organic', campaign_external_id: null },
      proposed: { channel: 'google_ads', source: 'google_ads_ga4', campaign_external_id: '24397202136', ad_group_external_id: '198779157982', app_instance_id: 'g1', campaignName: 'FitCircle Android - US - Installs (test)', adGroupName: 'Ad group 1' },
    });
    expect((by.get(HU1)!.evidence as any).ga4.heuristic).toMatchObject({ deltaSeconds: 77, country: 'match', device: 'match', ga4Country: 'VI' });
    expect(by.get(HU2)).toMatchObject({ outcome: 'enrich', status: 'would_apply', proposed: { channel: 'google_ads', source: 'google_ads', ad_group_external_id: '204681147547', adGroupName: 'Friends & circles' } });
    expect(by.get(HU5)).toMatchObject({ outcome: 'test', status: 'no_change', proposed: null });
    expect(by.get(HU6)).toMatchObject({ outcome: 'upgrade', confidence: 'low', status: 'below_confidence' });
    expect(by.get(HU7)).toMatchObject({ outcome: 'already_campaign', status: 'no_change' });
    expect(by.get(RU1)).toMatchObject({ outcome: 'enrich', method: 'referrer_gad_campaignid', confidence: 'exact', status: 'would_apply' });
    expect(by.get(RU2)).toMatchObject({ outcome: 'enrich', method: 'sole_google_campaign', confidence: 'low', status: 'below_confidence' });
    expect(by.has(HU3)).toBe(false);
    expect(by.has(HU4)).toBe(false);

    const um = new Map(r.unmatchedGoogle.map((u) => [u.userPseudoId, u.reason]));
    expect(um.get('g3')).toBe('ambiguous_user');
    expect(um.get('g3b')).toBe('ambiguous_user');
    expect(um.get('g4')).toBe('no_candidate');
    expect(um.has('o1')).toBe(false); // organic instances are not listed
    expect(r).toMatchObject({ upgraded: 1, enriched: 2, inserted: 0 });
  });

  it('apply: guarded writes, evidence + previous row kept, never test / paid-with-campaign rows; re-run is a no-op', async () => {
    const r = await run({ actorEmail: 'ani@inov8rlabs.com' });
    expect(r).toMatchObject({ upgraded: 1, enriched: 2 });
    expect(row(HU1)).toMatchObject({ channel: 'google_ads', source: 'google_ads_ga4', campaign_external_id: '24397202136', app_instance_id: 'g1' });
    expect(row(HU1).raw.ga4).toMatchObject({ matched_by: 'heuristic_time_geo_device', confidence: 'high', appliedBy: 'ani@inov8rlabs.com', heuristic: { fieldsUsed: ['time', 'country', 'device'] } });
    expect(row(HU1).raw.previous).toMatchObject({ channel: 'organic', source: 'google-play' });
    expect(row(HU2)).toMatchObject({ channel: 'google_ads', source: 'google_ads', campaign_external_id: '24397202136', ad_group_external_id: '204681147547', app_instance_id: 'g2' });
    expect(row(HU2).raw).toMatchObject({ has_gclid: 'true', ga4: { matched_by: 'heuristic_time_geo_device' } });
    expect(row(RU1)).toMatchObject({ campaign_external_id: '24397202136' });
    expect(row(RU1).raw.campaign_enrichment).toMatchObject({ matched_by: 'referrer_gad_campaignid' });
    expect(row(HU5)).toMatchObject({ channel: 'organic', campaign_external_id: null });
    expect(row(HU6)).toMatchObject({ channel: 'organic' });
    expect(row(RU2).campaign_external_id).toBeNull();
    expect(row(HU7).raw).toEqual({ ga4: { matched_by: 'manual' } });

    const snapshot = JSON.stringify(db.rows('user_attribution'));
    const again = await run();
    expect(again).toMatchObject({ upgraded: 0, enriched: 0, inserted: 0 });
    expect(JSON.stringify(db.rows('user_attribution'))).toBe(snapshot);
  });

  it('minConfidence low applies the low rows too; userIds limits writes to the reviewed rows', async () => {
    const r = await run({ minConfidence: 'low', userIds: [HU6, RU2] });
    expect(r).toMatchObject({ upgraded: 1, enriched: 1 });
    expect(row(HU6)).toMatchObject({ channel: 'google_ads', source: 'google_ads_ga4' });
    expect(row(RU2)).toMatchObject({ campaign_external_id: '24397202136' });
    expect(row(HU1).channel).toBe('organic'); // not selected
    expect(r.preview.find((p) => p.userId === HU1)?.status).toBe('not_selected');
  });

  it('an exact id beats the fallback, and an admin alias is excluded like any test user', async () => {
    db.rows('profiles').push({ id: 'admin', email: 'ani@inov8rlabs.com', email_canonical: 'aniowner@gmail.com', is_admin: true, created_at: '2025-01-01T00:00:00Z' });
    db.rows('profiles').find((p) => p.id === HU2)!.email = 'Ani.Owner+fit@gmail.com';
    // HU1 reported its app instance id: joined exactly, no heuristic needed.
    row(HU1).app_instance_id = 'g1';
    const r = await run({ dryRun: true });
    const by = new Map(r.preview.map((p) => [p.userId, p]));
    expect(by.get(HU1)).toMatchObject({ method: 'app_instance_id', confidence: 'exact', outcome: 'upgrade' });
    expect(by.get(HU2)).toMatchObject({ outcome: 'test', proposed: null });
    expect(r.exactMatched).toBe(1);
  });

  it('a paid row written after the plan is not replaced', async () => {
    const realClient = db.client.bind(db);
    db.client = () => {
      const c = realClient();
      return {
        from: (t: string) => {
          const q: any = c.from(t);
          const update = q.update.bind(q);
          q.update = (patch: any) => {
            row(HU1).channel = 'meta';
            return update(patch);
          };
          return q;
        },
      };
    };
    const r = await run({ userIds: [HU1] });
    expect(r.outcomes).toMatchObject({ lost_race: 1 });
    expect(row(HU1)).toMatchObject({ channel: 'meta', source: 'google-play' });
  });
});

describe('/api/admin/ads/ga4-attribution', () => {
  const req = (method: string, qs = '', body?: unknown, headers: Record<string, string> = {}) =>
    new NextRequest(`https://www.fitcircle.ai/api/admin/ads/ga4-attribution${qs}`, {
      method,
      headers: { authorization: 'Bearer admin-s', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  beforeEach(() => {
    vi.stubEnv('ADMIN_API_SECRET', 'admin-s');
    vi.spyOn(Ga4AttributionService, 'run').mockImplementation(async (o: any) => ({ echo: o }) as any);
  });

  it('GET is a dry run (forced, even with the cron off); bad ranges → 400; no secret → 401', async () => {
    const res = await previewGET(req('GET', '?start=2026-11-01&end=2026-11-07&minConfidence=low'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.echo).toMatchObject({ start: '2026-11-01', end: '2026-11-07', minConfidence: 'low', dryRun: true, force: true });
    expect((await previewGET(req('GET', '?start=2026-11-07&end=2026-11-01'))).status).toBe(400);
    expect((await previewGET(req('GET', '?minConfidence=bogus')).then((r) => r.json())).data.echo.minConfidence).toBe('medium');
    const anon = new NextRequest('https://www.fitcircle.ai/api/admin/ads/ga4-attribution');
    expect((await previewGET(anon)).status).toBe(401);
  });

  it('POST applies with the actor; needs X-Admin-Actor; validates userIds', async () => {
    expect((await applyPOST(req('POST', '', { start: '2026-11-01', end: '2026-11-07' }))).status).toBe(400); // missing actor
    const res = await applyPOST(req('POST', '', { start: '2026-11-01', end: '2026-11-07', userIds: [HU1] }, { 'x-admin-actor': 'ani@inov8rlabs.com' }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.echo).toMatchObject({ dryRun: false, force: true, userIds: [HU1], actorEmail: 'ani@inov8rlabs.com', minConfidence: 'medium' });
    expect((await applyPOST(req('POST', '', { userIds: ['nope'] }, { 'x-admin-actor': 'ani@inov8rlabs.com' }))).status).toBe(400);
    expect((await applyPOST(req('POST', '', { userIds: [] }, { 'x-admin-actor': 'ani@inov8rlabs.com' }))).status).toBe(400);
  });
});

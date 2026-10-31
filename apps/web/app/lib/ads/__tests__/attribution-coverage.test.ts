/**
 * Network conversions (Google Ads conversion actions) and attribution coverage:
 * GAQL + mapping, the sync's ad_conversions_daily writes, and how the report /
 * data health put network sign-ups next to our attributed users.
 */
import { generateKeyPairSync } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('./fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { setConnectorsForTest } from '../connectors';
import { clearGoogleTokenCache, conversionKind, gaqlConversionsDaily, GoogleAdsConnector, mapGoogleConversions, parseServiceAccountKey } from '../connectors/google-ads';
import type { AdsConnector } from '../connectors/types';
import { attributionCoverage, channelCoverageLine } from '../data-health';
import { METRIC_DEFINITIONS } from '../definitions';
import type { CohortUser } from '../metrics';
import { buildRows, buildTotals, networkFor, totalsNetwork } from '../report';
import { AdsSyncService } from '../services/sync-service';
import type { AdConversionRow, AdMetricRow, AttributionRow } from '../types';

import { AdsFakeDb, setAdsDb } from './fake-db';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = parseServiceAccountKey(
  JSON.stringify({ private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), client_email: 'google-ads-reporting@fitcircle-fitness-app.iam.gserviceaccount.com' })
)!;
const CREDS = { key: KEY, customerId: '7708137566', loginCustomerId: null, developerToken: null };

const GCAMP = '24397202136';
const INSTALLS_ACTION = 'FitCircle: Fitness & Nutrition (Android) installs 2026-10-27T08:06:49.378';
const SIGN_UP_ACTION = 'fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) sign_up';
const TRIAL_ACTION = 'fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) trial_start';

const gconv = (date: string, id: string, name: string, category: string, conversions: number, all = conversions) => ({
  campaign: { resourceName: `customers/7708137566/campaigns/${GCAMP}`, id: GCAMP },
  metrics: { conversions, allConversions: all },
  segments: { date, conversionAction: `customers/7708137566/conversionActions/${id}`, conversionActionName: name, conversionActionCategory: category },
});

beforeEach(() => {
  clearGoogleTokenCache();
  setAdsDb(new AdsFakeDb());
  setConnectorsForTest(null);
});

describe('conversionKind', () => {
  it.each([
    [INSTALLS_ACTION, 'DOWNLOAD', 'install'],
    ['fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) First open', 'DOWNLOAD', 'install'],
    [SIGN_UP_ACTION, 'DEFAULT', 'sign_up'],
    [SIGN_UP_ACTION, 'SIGNUP', 'sign_up'],
    ['Website sign-ups', 'SIGNUP', 'sign_up'],
    [TRIAL_ACTION, 'PURCHASE', 'trial'],
    ['fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) activated', 'DEFAULT', 'activation'],
    ['fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) purchase', 'PURCHASE', 'purchase'],
    ['fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) In-app purchase', 'PURCHASE', 'purchase'],
    ['fitcircle-fitness-app - com.inov8rlabs.apps.fitcircle (Android) session_start', 'PAGE_VIEW', 'other'],
  ])('%s / %s → %s', (name, category, kind) => {
    expect(conversionKind(name, category)).toBe(kind);
  });
});

describe('Google Ads conversions (GAQL + mapping)', () => {
  it('selects conversion-action segments with conversion metrics only, campaign level', () => {
    const q = gaqlConversionsDaily('2026-10-24', '2026-10-30');
    expect(q).toMatch(/^SELECT campaign\.id, segments\.date, segments\.conversion_action, segments\.conversion_action_name,/);
    expect(q).toContain('metrics.conversions, metrics.all_conversions');
    expect(q).not.toContain('cost_micros');
    expect(q).toContain("FROM campaign WHERE segments.date BETWEEN '2026-10-24' AND '2026-10-30'");
  });

  it('maps action ids from resource names, buckets kinds, sums duplicate rows, keeps fractions', () => {
    const rows = mapGoogleConversions([
      gconv('2026-10-29', '7875614567', INSTALLS_ACTION, 'DOWNLOAD', 25),
      gconv('2026-10-29', '7900000001', SIGN_UP_ACTION, 'DEFAULT', 0, 4.5),
      gconv('2026-10-29', '7900000001', SIGN_UP_ACTION, 'DEFAULT', 0, 1),
      { segments: { date: '2026-10-29' }, metrics: {} }, // no campaign / action → dropped
    ]);
    expect(rows).toEqual([
      { channel: 'google_ads', level: 'campaign', externalId: GCAMP, campaignExternalId: GCAMP, date: '2026-10-29', conversionActionId: '7875614567', conversionActionName: INSTALLS_ACTION, category: 'DOWNLOAD', kind: 'install', conversions: 25, allConversions: 25 },
      { channel: 'google_ads', level: 'campaign', externalId: GCAMP, campaignExternalId: GCAMP, date: '2026-10-29', conversionActionId: '7900000001', conversionActionName: SIGN_UP_ACTION, category: 'DEFAULT', kind: 'sign_up', conversions: 0, allConversions: 5.5 },
    ]);
  });

  it('fetchConversions is one read-only search', async () => {
    const urls: string[] = [];
    const fetchFn = async (url: string, init: RequestInit = {}) => {
      urls.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3599 }), { status: 200 });
      expect(JSON.parse(String(init.body)).query).toBe(gaqlConversionsDaily('2026-10-28', '2026-10-30'));
      return new Response(JSON.stringify({ results: [gconv('2026-10-30', '7875614567', INSTALLS_ACTION, 'DOWNLOAD', 29)] }), { status: 200 });
    };
    const c = new GoogleAdsConnector({ fetch: fetchFn, credentials: CREDS });
    expect(await c.fetchConversions('2026-10-28', '2026-10-30')).toMatchObject([{ kind: 'install', conversions: 29, date: '2026-10-30' }]);
    expect(urls.filter((u) => u.includes('googleAds:search'))).toHaveLength(1);
    expect(urls.some((u) => /mutate/i.test(u))).toBe(false);
    await expect(c.fetchConversions('2026-10-28', 'bad')).rejects.toThrow(/bad date/);
  });
});

function fakeConnector(conversions: () => Promise<any[]>): AdsConnector {
  return {
    channel: 'google_ads',
    isConfigured: () => true,
    fetchEntities: async () => [],
    fetchDailyMetrics: async () => [
      { channel: 'google_ads', level: 'campaign', externalId: GCAMP, campaignExternalId: GCAMP, date: '2026-10-30', spend: 40, currency: 'USD', impressions: 1000, taps: 50, installs: 29, newDownloads: 29, redownloads: 0 },
    ],
    readEntity: async () => null,
    applyChange: async () => {
      throw new Error('read-only');
    },
    fetchConversions: async () => conversions(),
  };
}

describe('sync writes ad_conversions_daily', () => {
  it('upserts per (campaign, day, action), replaces the window, and is idempotent', async () => {
    const db = new AdsFakeDb();
    setAdsDb(db);
    // a stale row inside the window (Google later removed it) and one outside
    db.rows('ad_conversions_daily').push(
      { channel: 'google_ads', level: 'campaign', external_id: GCAMP, date: '2026-10-28', conversion_action_id: 'gone', kind: 'other', conversions: 1, all_conversions: 1 },
      { channel: 'google_ads', level: 'campaign', external_id: GCAMP, date: '2026-10-01', conversion_action_id: 'old', kind: 'install', conversions: 3, all_conversions: 3 }
    );
    const rows = mapGoogleConversions([gconv('2026-10-30', '7875614567', INSTALLS_ACTION, 'DOWNLOAD', 29), gconv('2026-10-30', '7900000001', SIGN_UP_ACTION, 'DEFAULT', 0, 6)]);
    setConnectorsForTest({ google_ads: fakeConnector(async () => rows) });
    db.rows('ad_sync_runs').push({ id: 'prior', channel: 'google_ads', ok: true, finished_at: '2026-10-29T00:00:00Z', started_at: '2026-10-29T00:00:00Z' });

    const [r] = await AdsSyncService.run({ channels: ['google_ads'], start: '2026-10-27', end: '2026-10-30' });
    expect(r).toMatchObject({ ok: true, rowsMetrics: 1, rowsConversions: 2, conversionsError: null });
    const stored = () => db.rows('ad_conversions_daily').map((x) => `${x.date}:${x.conversion_action_id}:${x.kind}:${x.all_conversions}`).sort();
    expect(stored()).toEqual(['2026-10-01:old:install:3', '2026-10-30:7875614567:install:29', '2026-10-30:7900000001:sign_up:6']);
    await AdsSyncService.run({ channels: ['google_ads'], start: '2026-10-27', end: '2026-10-30' });
    expect(stored()).toHaveLength(3);
  });

  it('a conversions failure (e.g. migration 117 not applied) never fails the delivery sync', async () => {
    const db = new AdsFakeDb();
    setAdsDb(db);
    setConnectorsForTest({ google_ads: fakeConnector(async () => [{ channel: 'google_ads' }]) });
    db.failing.add('ad_conversions_daily');
    const [r] = await AdsSyncService.run({ channels: ['google_ads'], start: '2026-10-30', end: '2026-10-30' });
    expect(r.ok).toBe(true);
    expect(r.rowsMetrics).toBe(1);
    expect(r.conversionsError).toMatch(/ad_conversions_daily/);
    expect(db.rows('ad_metrics_daily')).toHaveLength(1);
    expect(db.rows('ad_sync_runs')[0]).toMatchObject({ ok: true, error: null });
  });
});

// ---------------------------------------------------------------------------
// Report + data health
// ---------------------------------------------------------------------------

const metric = (channel: AdMetricRow['channel'], id: string, installs: number, spend = 10): AdMetricRow => ({
  channel,
  level: 'campaign',
  external_id: id,
  campaign_external_id: id,
  date: '2026-10-29',
  spend,
  currency: 'USD',
  impressions: 100,
  taps: 10,
  installs,
});
const conv = (kind: AdConversionRow['kind'], all: number, id = GCAMP): AdConversionRow => ({
  channel: 'google_ads',
  level: 'campaign',
  external_id: id,
  campaign_external_id: id,
  date: '2026-10-29',
  conversion_action_id: `${kind}-action`,
  conversion_action_name: kind,
  kind,
  conversions: 0,
  all_conversions: all,
});
let n = 0;
const user = (channel: AttributionRow['channel'] | null, campaign: string | null = null): CohortUser => {
  n += 1;
  return {
    userId: `u${n}`,
    signupAt: '2026-10-29T15:00:00Z',
    signupDate: '2026-10-29',
    attribution: channel
      ? { user_id: `u${n}`, channel, platform: 'android', source: channel === 'organic' ? 'google-play' : channel, campaign_external_id: campaign, ad_group_external_id: null, keyword_external_id: null, ad_external_id: null, click_at: null, country: null, is_test: false, raw: null }
      : null,
    firstActivityAt: null,
    events: [],
  };
};

const metricRows = [metric('google_ads', GCAMP, 29, 40), metric('apple_ads', 'A1', 10)];
const cohort = [user('google_ads', GCAMP), user('google_ads', GCAMP), user('google_ads', GCAMP), user('apple_ads', 'A1'), user('apple_ads', 'A1'), user('organic'), user('organic')];

describe('network sign-ups / trials and attribution coverage in the report', () => {
  it('networkFor: null when the network has no such action, summed all_conversions otherwise', () => {
    expect(networkFor([conv('install', 29)])).toEqual({ signUps: null, trials: null });
    expect(networkFor([conv('sign_up', 4.5), conv('sign_up', 1.5), conv('trial', 2)])).toEqual({ signUps: 6, trials: 2 });
  });

  it('by channel: Google uses its sign-ups; Apple (no conversions) uses installs; organic has none', () => {
    const rows = buildRows('channel', { metricRows, entities: [], cohort, conversionRows: [conv('install', 29), conv('sign_up', 12), conv('trial', 3)], rangeEnd: '2026-10-29', today: '2026-10-30' });
    const by = Object.fromEntries(rows.map((r) => [r.key, r.metrics]));
    expect(by.google_ads).toMatchObject({ users: 3, installs: 29, networkSignUps: 12, networkTrials: 3, attributionCoverage: 0.25, attributionCoverageBasis: 'sign_ups' });
    expect(by.apple_ads).toMatchObject({ users: 2, installs: 10, networkSignUps: null, networkTrials: null, attributionCoverage: 0.2, attributionCoverageBasis: 'installs' });
    expect(by.organic).toMatchObject({ users: 2, networkSignUps: null, attributionCoverage: null, attributionCoverageBasis: null });
  });

  it('Google without an imported sign-up action falls back to installs (today’s prod state)', () => {
    const rows = buildRows('channel', { metricRows, entities: [], cohort, conversionRows: [conv('install', 29)], rangeEnd: '2026-10-29', today: '2026-10-30' });
    expect(rows.find((r) => r.key === 'google_ads')!.metrics).toMatchObject({ networkSignUps: null, attributionCoverageBasis: 'installs' });
    expect(rows.find((r) => r.key === 'google_ads')!.metrics.attributionCoverage).toBeCloseTo(3 / 29);
  });

  it('by campaign carries the campaign’s conversions; ad-group level carries none', () => {
    const input = { metricRows, entities: [], cohort, conversionRows: [conv('sign_up', 12)], rangeEnd: '2026-10-29', today: '2026-10-30' };
    const camp = buildRows('campaign', input).find((r) => r.externalId === GCAMP)!;
    expect(camp.metrics).toMatchObject({ networkSignUps: 12, attributionCoverage: 0.25 });
    for (const r of buildRows('ad_group', input)) expect(r.metrics.networkSignUps).toBeNull();
  });

  it('totals: sums network counts; coverage over each channel’s own basis (mixed)', () => {
    const totals = buildTotals({ metricRows, entities: [], cohort, conversionRows: [conv('sign_up', 12), conv('trial', 3)], rangeEnd: '2026-10-29', today: '2026-10-30' });
    // paid users 5 ÷ (Google 12 sign-ups + Apple 10 installs)
    expect(totals.metrics).toMatchObject({ users: 5, networkSignUps: 12, networkTrials: 3, attributionCoverageBasis: 'mixed' });
    expect(totals.metrics.attributionCoverage).toBeCloseTo(5 / 22);
    const noConv = buildTotals({ metricRows, entities: [], cohort, rangeEnd: '2026-10-29', today: '2026-10-30' });
    expect(noConv.metrics).toMatchObject({ networkSignUps: null, attributionCoverageBasis: 'installs' });
    expect(noConv.metrics.attributionCoverage).toBeCloseTo(5 / 39);
    expect(totalsNetwork([], [])).toEqual({ signUps: null, trials: null, coverage: null });
  });

  it('every new metric has a definition', () => {
    for (const k of ['networkSignUps', 'networkTrials', 'attributionCoverage'] as const) expect(METRIC_DEFINITIONS[k]).toBeTruthy();
  });
});

describe('data health: per-channel attribution coverage', () => {
  it('lists each paid channel with its basis and warns when a channel is under 50%', () => {
    const cov = attributionCoverage(metricRows, cohort, [conv('install', 29), conv('sign_up', 12), conv('trial', 3)]);
    expect(cov.byChannel).toEqual([
      { channel: 'apple_ads', installs: 10, networkSignUps: null, networkTrials: null, attributedUsers: 2, coveragePct: 20, basis: 'installs' },
      { channel: 'google_ads', installs: 29, networkSignUps: 12, networkTrials: 3, attributedUsers: 3, coveragePct: 25, basis: 'sign_ups' },
    ]);
    expect(cov.status).toBe('warn');
    expect(channelCoverageLine(cov.byChannel[1])).toBe('Google Ads: 3 attributed users for 12 Google Ads-reported sign-ups (25%); 3 Google Ads-reported trials');
    expect(channelCoverageLine(cov.byChannel[0])).toBe('Apple Ads: 2 attributed users for 10 installs (20%; no sign-up conversion reported)');
    expect(cov.explanation).toMatch(/advertising id/);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildAdsEmailReport,
  type BuildReportInput,
  deliveryStats,
  type FunnelUser,
  funnelStats,
  hourInTz,
  launchDateFrom,
  renderHtml,
  renderSubject,
  renderText,
  reportWindows,
  type SyncState,
} from '../email-report';
import type { AdEntityRow, AdMetricRow } from '../types';

const TZ = 'America/Toronto';
// 2026-10-27 08:00 EDT
const AM = new Date('2026-10-27T12:00:00Z');
// 2026-10-27 18:00 EDT
const PM = new Date('2026-10-27T22:00:00Z');

const campaign = (over: Partial<AdEntityRow> = {}): AdEntityRow => ({
  channel: 'apple_ads',
  platform: 'ios',
  level: 'campaign',
  external_id: '2144950391',
  parent_external_id: null,
  campaign_external_id: '2144950391',
  name: 'US - Search - Concept test (CPP)',
  status: 'ENABLED',
  serving_status: 'RUNNING',
  bid_strategy: null,
  bid_amount: null,
  bid_currency: null,
  daily_budget: 50,
  total_budget: null,
  match_type: null,
  countries: ['US'],
  start_at: '2026-10-24T10:30:00Z',
  end_at: null,
  creative: null,
  synced_at: '2026-10-27T11:20:00Z',
  ...over,
});

const day = (date: string, spend: number, impressions: number, taps: number, installs: number, over: Partial<AdMetricRow> = {}): AdMetricRow => ({
  channel: 'apple_ads',
  level: 'campaign',
  external_id: '2144950391',
  campaign_external_id: '2144950391',
  date,
  spend: String(spend),
  currency: 'USD',
  impressions,
  taps,
  installs,
  ...over,
});

// Mirrors prod on 2026-10-27 (string spend like PostgREST numeric).
const METRICS: AdMetricRow[] = [
  day('2026-10-23', 0, 0, 0, 0),
  day('2026-10-24', 10.47, 37, 3, 1),
  day('2026-10-25', 75.02, 282, 24, 10),
  day('2026-10-26', 65.75, 366, 20, 8),
  day('2026-10-27', 18.58, 107, 6, 3),
  // Lower levels are ignored (they'd double count).
  day('2026-10-27', 18.58, 107, 6, 3, { level: 'keyword', external_id: 'K1' }),
];

const okSync = (now: Date): SyncState[] => [
  { channel: 'apple_ads', configured: true, lastSuccessAt: new Date(now.getTime() - 40 * 60_000).toISOString(), lastFinishedAt: new Date(now.getTime() - 40 * 60_000).toISOString(), lastFinishedOk: true, lastError: null },
  { channel: 'meta', configured: false, lastSuccessAt: null, lastFinishedAt: null, lastFinishedOk: null, lastError: null },
];

const user = (over: Partial<FunnelUser>): FunnelUser => ({
  userId: Math.random().toString(36).slice(2),
  signupDate: '2026-10-27',
  testReason: null,
  platform: 'ios',
  onboarded: false,
  firstMeal: false,
  trial: false,
  payer: false,
  paidChannel: null,
  campaignExternalId: null,
  ...over,
});

const input = (over: Partial<BuildReportInput> = {}): BuildReportInput => ({
  now: AM,
  timeZone: TZ,
  consoleUrl: 'https://admintools.inov8rlabs.com/apps/fitcircle/ads',
  entities: [campaign()],
  metricRows: METRICS,
  sync: okSync(over.now ?? AM),
  users: [],
  launchDate: '2026-10-24',
  ...over,
});

describe('time zone windows', () => {
  it('today / yesterday / since launch in the report time zone', () => {
    expect(reportWindows(AM, TZ, '2026-10-24')).toEqual([
      { key: 'today', label: 'Today (so far)', start: '2026-10-27', end: '2026-10-27' },
      { key: 'yesterday', label: 'Yesterday', start: '2026-10-26', end: '2026-10-26' },
      { key: 'launch', label: 'Since launch (2026-10-24)', start: '2026-10-24', end: '2026-10-27' },
    ]);
  });

  it('late evening local is still "today" even though UTC has rolled over', () => {
    const lateLocal = new Date('2026-10-28T03:30:00Z'); // 23:30 EDT Oct 27
    expect(reportWindows(lateLocal, TZ, '2026-10-24')[0].start).toBe('2026-10-27');
    expect(reportWindows(new Date('2026-10-28T04:30:00Z'), TZ, '2026-10-24')[0].start).toBe('2026-10-28');
  });

  it('after DST ends the same UTC cron hour is an hour earlier locally; slot still AM/PM', () => {
    expect(hourInTz(AM, TZ)).toBe(8);
    expect(hourInTz(PM, TZ)).toBe(18);
    expect(hourInTz(new Date('2026-11-03T12:00:00Z'), TZ)).toBe(7);
    expect(hourInTz(new Date('2026-11-03T22:00:00Z'), TZ)).toBe(17);
  });

  it('launch date = earliest live / spending campaign start in the report zone', () => {
    expect(launchDateFrom([campaign()], METRICS, TZ, '2026-10-27', AM)).toBe('2026-10-24');
    // A paused campaign that never spent does not move launch back.
    const old = campaign({ external_id: 'OLD', status: 'PAUSED', start_at: '2026-01-01T00:00:00Z' });
    expect(launchDateFrom([campaign(), old], METRICS, TZ, '2026-10-27', AM)).toBe('2026-10-24');
    // No entities: first day with spend.
    expect(launchDateFrom([], METRICS, TZ, '2026-10-27', AM)).toBe('2026-10-24');
    expect(launchDateFrom([], [], TZ, '2026-10-27', AM)).toBe('2026-10-27');
  });
});

describe('aggregation', () => {
  it('sums campaign-level delivery per window with CPI, TTR and conversion', () => {
    const r = buildAdsEmailReport(input());
    expect(r.campaigns).toHaveLength(1);
    const c = r.campaigns[0];
    expect(c.live).toBe(true);
    expect(c.windows.today).toMatchObject({ spend: 18.58, impressions: 107, taps: 6, installs: 3 });
    expect(c.windows.today.cpi).toBeCloseTo(6.193, 3);
    expect(c.windows.yesterday).toMatchObject({ spend: 65.75, installs: 8 });
    expect(c.windows.launch).toMatchObject({ spend: 169.82, impressions: 792, taps: 53, installs: 22 });
    expect(c.windows.launch.cpi).toBeCloseTo(7.719, 3);
    expect(c.windows.launch.ttr).toBeCloseTo(53 / 792, 6);
    expect(c.windows.launch.conversionRate).toBeCloseTo(22 / 53, 6);
    expect(r.totals.launch.spend).toBe(169.82);
    expect(r.totals.yesterday.installs).toBe(8);
  });

  it('ratios are null (—) when the denominator is 0', () => {
    const s = deliveryStats([]);
    expect(s).toMatchObject({ spend: 0, cpi: null, ttr: null, conversionRate: null });
    expect(renderText(buildAdsEmailReport(input({ metricRows: [] })))).toContain('—');
  });

  it('Google Ads reports its config state until it has data; Meta too', () => {
    const r = buildAdsEmailReport(input());
    expect(r.notConnected.map((n) => n.text)).toEqual([
      'Meta: not connected (no API credentials configured)',
      'Google Ads (Android): not configured (GOOGLE_ADS_SA_KEY missing)',
    ]);
    const g = (over: Partial<SyncState>): SyncState => ({ channel: 'google_ads', configured: true, lastSuccessAt: null, lastFinishedAt: null, lastFinishedOk: null, lastError: null, ...over });
    const awaitingSync = buildAdsEmailReport(input({ sync: [...okSync(AM), g({})] }));
    expect(awaitingSync.notConnected.find((n) => n.channel === 'google_ads')?.text).toBe('Google Ads (Android): connected, awaiting first successful sync');
    const awaitingData = buildAdsEmailReport(input({ sync: [...okSync(AM), g({ lastSuccessAt: AM.toISOString(), lastFinishedAt: AM.toISOString(), lastFinishedOk: true })] }));
    expect(awaitingData.notConnected.find((n) => n.channel === 'google_ads')?.text).toBe('Google Ads (Android): connected, awaiting data (no live campaigns or spend since launch)');
    const withGoogle = buildAdsEmailReport(
      input({
        entities: [campaign(), campaign({ channel: 'google_ads', platform: 'android', external_id: 'G1', campaign_external_id: 'G1', name: 'Android UAC', status: 'ENABLED', serving_status: null })],
        metricRows: [...METRICS, day('2026-10-27', 5, 100, 4, 2, { channel: 'google_ads', external_id: 'G1', campaign_external_id: 'G1' })],
      })
    );
    expect(withGoogle.notConnected.some((n) => n.channel === 'google_ads')).toBe(false);
    expect(withGoogle.totals.today).toMatchObject({ spend: 23.58, installs: 5 });
  });
});

describe('funnel and test-user exclusion', () => {
  const users = [
    user({ platform: 'ios', onboarded: true, firstMeal: true, paidChannel: 'apple_ads', campaignExternalId: '2144950391' }),
    user({ platform: 'android', onboarded: true }),
    user({ platform: 'unknown' }),
    user({ signupDate: '2026-10-26', platform: 'ios', onboarded: true, firstMeal: true, trial: true, payer: true }),
    user({ testReason: 'play_testers', platform: 'android', onboarded: true }),
    user({ testReason: 'internal', signupDate: '2026-10-26' }),
  ];

  it('counts real sign-ups by platform with outcomes; test users are only counted as excluded', () => {
    const r = buildAdsEmailReport(input({ users }));
    expect(r.funnel.today).toEqual({ signups: 3, byPlatform: { ios: 1, android: 1, unknown: 1 }, onboarded: 2, firstMeal: 1, trials: 0, payers: 0, attributedPaid: 1, excludedTest: 1 });
    expect(r.funnel.yesterday).toMatchObject({ signups: 1, trials: 1, payers: 1, excludedTest: 1 });
    expect(r.funnel.launch).toMatchObject({ signups: 4, onboarded: 3, firstMeal: 2, excludedTest: 2 });
  });

  it('funnelStats respects window bounds', () => {
    expect(funnelStats(users, { key: 'yesterday', label: '', start: '2026-10-25', end: '2026-10-25' }).signups).toBe(0);
  });
});

describe('alert rules', () => {
  it('healthy data → no alerts', () => {
    expect(buildAdsEmailReport(input()).alerts).toEqual([]);
  });

  it('live campaign with $0 yesterday and today → no_spend', () => {
    const rows = METRICS.filter((r) => r.date < '2026-10-26');
    const r = buildAdsEmailReport(input({ metricRows: [...rows, day('2026-10-26', 0, 0, 0, 0), day('2026-10-27', 0, 0, 0, 0)] }));
    expect(r.alerts.map((a) => a.kind)).toEqual(['no_spend']);
  });

  it('no_spend ignores paused campaigns and campaigns that started < 24 h ago', () => {
    const rows = METRICS.filter((r) => r.date < '2026-10-26');
    expect(buildAdsEmailReport(input({ entities: [campaign({ status: 'PAUSED' })], metricRows: rows })).alerts).toEqual([]);
    expect(buildAdsEmailReport(input({ entities: [campaign({ start_at: '2026-10-27T01:00:00Z' })], metricRows: [] })).alerts).toEqual([]);
  });

  it('yesterday CPI > 2× since-launch CPI → cpi_spike (also spend with 0 installs)', () => {
    const spike = [...METRICS.filter((r) => r.date !== '2026-10-26'), day('2026-10-26', 60, 300, 10, 1)];
    const r = buildAdsEmailReport(input({ metricRows: spike }));
    expect(r.alerts.map((a) => a.kind)).toEqual(['cpi_spike']);
    expect(r.alerts[0].message).toContain('$60.00');

    const zero = [...METRICS.filter((r) => r.date !== '2026-10-26'), day('2026-10-26', 40, 300, 10, 0)];
    const z = buildAdsEmailReport(input({ metricRows: zero }));
    expect(z.alerts.map((a) => a.kind)).toEqual(['cpi_spike']);
    expect(z.alerts[0].message).toContain('0 installs');
  });

  it('stale (> 3 h) or never-succeeded sync, and a failing last run', () => {
    const stale: SyncState[] = [{ ...okSync(AM)[0], lastSuccessAt: new Date(AM.getTime() - 4 * 3600_000).toISOString() }];
    expect(buildAdsEmailReport(input({ sync: stale })).alerts.map((a) => a.kind)).toEqual(['sync_stale']);
    const failing: SyncState[] = [{ ...okSync(AM)[0], lastFinishedOk: false, lastError: 'HTTP 401 invalid_client' }];
    const f = buildAdsEmailReport(input({ sync: failing }));
    expect(f.alerts.map((a) => a.kind)).toEqual(['sync_error']);
    expect(f.alerts[0].message).toContain('invalid_client');
    const never: SyncState[] = [{ ...okSync(AM)[0], lastSuccessAt: null }];
    expect(buildAdsEmailReport(input({ sync: never })).alerts.map((a) => a.kind)).toEqual(['sync_stale']);
    // Unconfigured channels never alert.
    expect(buildAdsEmailReport(input({ sync: [okSync(AM)[1]] })).alerts).toEqual([]);
  });
});

describe('rendering', () => {
  it('AM subject headlines yesterday, PM headlines today; alerts are counted', () => {
    expect(renderSubject(buildAdsEmailReport(input()))).toBe('FitCircle ads — Tue Oct 27 AM: $65.75 spend, 8 installs yesterday');
    expect(renderSubject(buildAdsEmailReport(input({ now: PM })))).toBe('FitCircle ads — Tue Oct 27 PM: $18.58 spend, 3 installs today');
    const stale: SyncState[] = [{ ...okSync(AM)[0], lastSuccessAt: null }];
    expect(renderSubject(buildAdsEmailReport(input({ sync: stale })))).toMatch(/\[1 alert\]$/);
  });

  it('text and HTML carry the tz, the console link, the data notes, and escape names', () => {
    const r = buildAdsEmailReport(input({ entities: [campaign({ name: 'A <b>&</b> B' })] }));
    const text = renderText(r);
    expect(text).toContain('Time zone: America/Toronto');
    expect(text).toContain('https://admintools.inov8rlabs.com/apps/fitcircle/ads');
    expect(text).toContain('Data notes');
    expect(text).toContain('Google Ads (Android): not configured (GOOGLE_ADS_SA_KEY missing)');
    const html = renderHtml(r);
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt; B');
    expect(html).not.toContain('<b>&</b>');
    expect(html).toContain('href="https://admintools.inov8rlabs.com/apps/fitcircle/ads"');
  });
});

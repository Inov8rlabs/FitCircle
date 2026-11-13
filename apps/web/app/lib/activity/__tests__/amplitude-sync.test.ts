import { gzipSync } from 'node:zlib';

import { zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('../../ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '../../ads/__tests__/fake-db';
import { FinanceData } from '../../finance/services/finance-data';
import { activitySinceOf } from '../../pmf/activity-signal';
import { buildKpis, type PmfFacts, type PmfUser } from '../../pmf/scorecard';
import {
  AMPLITUDE_INACTIVE_EVENT_TYPES,
  AmplitudeNotConfiguredError,
  fetchAmplitudeExportHour,
  hourKey,
  parseAmplitudeExportZip,
  parseAmplitudeTime,
  toActiveEvent,
  type AmplitudeRawEvent,
} from '../amplitude-export';
import { aggregateActiveEvents, AmplitudeSyncService } from '../amplitude-sync-service';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const ev = (over: Partial<AmplitudeRawEvent> = {}): AmplitudeRawEvent => ({
  user_id: U1,
  event_type: 'Screen Viewed',
  event_time: '2026-11-10 14:05:06.123456',
  platform: 'iOS',
  ...over,
});

function exportZip(files: Record<string, AmplitudeRawEvent[]>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, events] of Object.entries(files)) entries[name] = new Uint8Array(gzipSync(events.map((e) => JSON.stringify(e)).join('\n') + '\n'));
  return zipSync(entries);
}

describe('export parser', () => {
  it('reads every gzipped JSON-lines file in the zip and skips bad lines', () => {
    const zip = exportZip({ '746168/746168_2026-11-10_14#0.json.gz': [ev(), ev({ user_id: U2 })], '746168/746168_2026-11-10_14#1.json.gz': [ev({ event_type: 'Screen Viewed' })] });
    const withBad = zipSync({ 'x.json.gz': new Uint8Array(gzipSync('{"user_id":"a"}\nnot json\n')) });
    expect(parseAmplitudeExportZip(zip).events.map((e) => e.event_type)).toEqual(['Screen Viewed', 'Screen Viewed', 'Screen Viewed']);
    expect(parseAmplitudeExportZip(withBad)).toEqual({ events: [{ user_id: 'a' }], badLines: 1 });
  });

  it('parses Amplitude UTC times', () => {
    expect(parseAmplitudeTime('2026-11-10 14:05:06.123456')).toBe('2026-11-10T14:05:06.123Z');
    expect(parseAmplitudeTime('2026-11-10 14:05:06')).toBe('2026-11-10T14:05:06.000Z');
    expect(parseAmplitudeTime('garbage')).toBeNull();
  });

  it('404 = no data; missing secret = typed not-configured error', async () => {
    const env = { AMPLITUDE_SECRET_KEY: 's' } as unknown as NodeJS.ProcessEnv;
    const notFound = vi.fn(async (_url: string) => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    expect(await fetchAmplitudeExportHour('20261110T14', { env, fetchImpl: notFound })).toEqual({ events: [], badLines: 0 });
    expect(notFound.mock.calls[0][0]).toBe('https://amplitude.com/api/2/export?start=20261110T14&end=20261110T14');
    const zip = exportZip({ 'a.json.gz': [ev()] });
    const ok = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => zip.slice().buffer }));
    expect((await fetchAmplitudeExportHour('20261110T14', { env, fetchImpl: ok })).events).toHaveLength(1);
    await expect(fetchAmplitudeExportHour('20261110T14', { env: {} as NodeJS.ProcessEnv, fetchImpl: ok })).rejects.toBeInstanceOf(AmplitudeNotConfiguredError);
  });
});

describe('active-event filter', () => {
  it('keeps client user actions, lower-cases iOS upper-case ids, normalizes platform', () => {
    expect(toActiveEvent(ev({ user_id: U1.toUpperCase(), platform: 'iOS' }))).toEqual({ userId: U1, at: '2026-11-10T14:05:06.123Z', platform: 'ios', eventType: 'Screen Viewed' });
    expect(toActiveEvent(ev({ platform: 'Android' }))?.platform).toBe('android');
    expect(toActiveEvent(ev({ platform: 'Web' }))?.platform).toBe('web');
  });

  it('drops server / no-platform events, non-uuid users and inactive event types', () => {
    expect(toActiveEvent(ev({ platform: 'server' }))).toBeNull();
    expect(toActiveEvent(ev({ platform: null }))).toBeNull();
    expect(toActiveEvent(ev({ user_id: null }))).toBeNull();
    expect(toActiveEvent(ev({ user_id: 'device-123' }))).toBeNull();
    for (const t of AMPLITUDE_INACTIVE_EVENT_TYPES) expect(toActiveEvent(ev({ event_type: t }))).toBeNull();
    expect(toActiveEvent(ev({ event_type: 'Push Sent' }))).toBeNull();
    expect(toActiveEvent(ev({ event_type: 'Health Sync Completed' }))).toBeNull();
    expect(toActiveEvent(ev({ event_type: '[Experiment] Exposure' }))).toBeNull();
    expect(toActiveEvent(ev({ event_type: '[Amplitude] Application Opened' }))).not.toBeNull();
  });

  it('on iOS / Android counts only foreground events (app opened, screen viewed); any web event counts', () => {
    for (const platform of ['iOS', 'Android']) {
      expect(toActiveEvent(ev({ platform, event_type: 'Screen Viewed' }))).not.toBeNull();
      expect(toActiveEvent(ev({ platform, event_type: '[Amplitude] Application Opened' }))).not.toBeNull();
      // Can fire from a background process start (sync, widget refresh, push delivery):
      expect(toActiveEvent(ev({ platform, event_type: 'Meal Logged' }))).toBeNull();
      expect(toActiveEvent(ev({ platform, event_type: 'Widget Refreshed' }))).toBeNull();
    }
    expect(toActiveEvent(ev({ platform: 'Web', event_type: 'Meal Logged' }))?.platform).toBe('web');
    expect(toActiveEvent(ev({ platform: 'Web', event_type: '[Amplitude] Page Viewed' }))?.platform).toBe('web');
  });
});

describe('local-date bucketing', () => {
  it('buckets by the profile zone across a day boundary and keeps first / last / count', () => {
    const events = [
      ev({ event_time: '2026-11-10 04:30:00' }), // 20:30 Nov 9 in Los Angeles
      ev({ event_time: '2026-11-10 07:59:00' }), // 23:59 Nov 9 in Los Angeles
      ev({ event_time: '2026-11-10 08:01:00' }), // 00:01 Nov 10 in Los Angeles
      ev({ user_id: U2, event_time: '2026-11-10 04:30:00' }), // 10:00 Nov 10 in Kolkata
      ev({ user_id: '33333333-3333-4333-8333-333333333333' }), // no profile → dropped
    ]
      .map(toActiveEvent)
      .filter((e) => !!e)
      .map((e) => e!);
    const tz: Record<string, string> = { [U1]: 'America/Los_Angeles', [U2]: 'Asia/Kolkata' };
    const rows = aggregateActiveEvents(events, (id) => tz[id]);
    expect(rows).toEqual([
      { user_id: U1, local_date: '2026-11-09', platform: 'ios', source: 'amplitude', first_at: '2026-11-10T04:30:00.000Z', last_at: '2026-11-10T07:59:00.000Z', event_count: 2 },
      { user_id: U1, local_date: '2026-11-10', platform: 'ios', source: 'amplitude', first_at: '2026-11-10T08:01:00.000Z', last_at: '2026-11-10T08:01:00.000Z', event_count: 1 },
      { user_id: U2, local_date: '2026-11-10', platform: 'ios', source: 'amplitude', first_at: '2026-11-10T04:30:00.000Z', last_at: '2026-11-10T04:30:00.000Z', event_count: 1 },
    ]);
  });
});

describe('AmplitudeSyncService', () => {
  let db: AdsFakeDb;
  beforeEach(() => {
    db = new AdsFakeDb();
    db.rows('profiles').push({ id: U1, timezone: 'UTC' }, { id: U2, timezone: 'Asia/Kolkata' });
    setAdsDb(db);
  });

  const byHour: Record<string, AmplitudeRawEvent[]> = {
    '20261110T14': [ev({ event_time: '2026-11-10 14:10:00' }), ev({ user_id: U1.toUpperCase(), event_time: '2026-11-10 14:20:00' }), ev({ event_type: 'Push Sent' })],
    '20261110T15': [ev({ event_time: '2026-11-10 15:05:00' }), ev({ user_id: U2, platform: 'Android', event_time: '2026-11-10 15:30:00' })],
  };
  const fetcher = vi.fn(async (h: string) => ({ events: byHour[h] ?? [], badLines: 0 }));

  it('merges hours into one row per local day (placeholder UTC zone → New York) and skips synced hours', async () => {
    await AmplitudeSyncService.syncRange('20261110T14', '20261110T15', { fetcher });
    const rows = () => db.rows('user_active_days').map(({ id: _id, ...r }) => r);
    const expected = [
      { user_id: U1, local_date: '2026-11-10', platform: 'ios', source: 'amplitude', first_at: '2026-11-10T14:10:00.000Z', last_at: '2026-11-10T15:05:00.000Z', event_count: 3 },
      { user_id: U2, local_date: '2026-11-10', platform: 'android', source: 'amplitude', first_at: '2026-11-10T15:30:00.000Z', last_at: '2026-11-10T15:30:00.000Z', event_count: 1 },
    ];
    expect(rows()).toEqual(expected);
    expect(db.rows('amplitude_export_sync').map((r) => [r.hour, r.events, r.users])).toEqual([
      ['20261110T14', 2, 1],
      ['20261110T15', 2, 2],
    ]);

    fetcher.mockClear();
    const again = await AmplitudeSyncService.syncRange('20261110T14', '20261110T15', { fetcher });
    expect(again.every((h) => h.skipped)).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(rows()).toEqual(expected);

    const forced = await AmplitudeSyncService.syncHour('20261110T14', { fetcher, force: true });
    expect(forced.skipped).toBe(false);
    expect(rows()[0]).toMatchObject({ first_at: '2026-11-10T14:10:00.000Z', last_at: '2026-11-10T15:05:00.000Z', event_count: 5 });
  });

  it('cron syncs from the hour after the last synced one up to now − 3 h, ≤ 24 hours', async () => {
    db.rows('amplitude_export_sync').push({ hour: '20261110T12', events: 0, users: 0 });
    const now = new Date('2026-11-10T18:40:00Z');
    const r = await AmplitudeSyncService.cronSync(now, { fetcher });
    expect(r.hours.map((h) => h.hour)).toEqual(['20261110T13', '20261110T14']);
    expect(hourKey(now)).toBe('20261110T18');

    const fresh = new AdsFakeDb();
    setAdsDb(fresh);
    const first = await AmplitudeSyncService.cronSync(now, { fetcher });
    expect(first.from).toBe('20261108T18');
    expect(first.hours).toHaveLength(24);
  });

  it('never syncs or marks an hour Amplitude has not finished exporting (backfill of today)', async () => {
    const now = new Date('2026-11-10T18:40:00Z'); // latest complete hour: T14
    const r = await AmplitudeSyncService.syncRange('20261110T13', '20261110T23', { fetcher, now });
    expect(r.map((h) => h.hour)).toEqual(['20261110T13', '20261110T14']);
    expect(db.rows('amplitude_export_sync').map((x) => x.hour)).toEqual(['20261110T13', '20261110T14']);
    expect(await AmplitudeSyncService.syncRange('20261110T20', '20261110T23', { fetcher, now })).toEqual([]);
  });

  it('FinanceData.activity reads Amplitude days (first and last instant)', async () => {
    await AmplitudeSyncService.syncRange('20261110T14', '20261110T15', { fetcher });
    const { rows, note } = await FinanceData.activity('2026-11-01T00:00:00Z', '2026-11-12T00:00:00Z');
    expect(note).toBeNull();
    expect(rows).toEqual(
      expect.arrayContaining([
        { userId: U1, at: '2026-11-10T14:10:00.000Z', platform: 'ios' },
        { userId: U1, at: '2026-11-10T15:05:00.000Z', platform: 'ios' },
        { userId: U2, at: '2026-11-10T15:30:00.000Z', platform: 'android' },
      ])
    );
    expect(await AmplitudeSyncService.coverage()).toEqual({ since: '2026-11-10T14:00:00.000Z', through: '2026-11-10T16:00:00.000Z' });
  });

  it('fails soft before migration 136', async () => {
    db.failing.add('user_active_days');
    db.failing.add('amplitude_export_sync');
    const { rows, note } = await FinanceData.activity('2026-11-01T00:00:00Z', '2026-11-12T00:00:00Z');
    expect(rows).toEqual([]);
    expect(note).toContain('user_active_days is not available');
    expect(await AmplitudeSyncService.coverage()).toEqual({ since: null, through: null });
  });
});

describe('PMF: Amplitude-only activity', () => {
  it('a user active only in Amplitude on day 1 counts as D1-retained', async () => {
    const db = new AdsFakeDb();
    setAdsDb(db);
    db.rows('profiles').push({ id: U1, timezone: 'America/New_York' });
    // Signed up Nov 3 (NY); next local day only an Amplitude event, no feed load / app open / meal.
    const day1: Record<string, AmplitudeRawEvent[]> = { '20261104T15': [ev({ event_type: 'Screen Viewed', event_time: '2026-11-04 15:00:00' })] };
    await AmplitudeSyncService.syncHour('20261104T15', { fetcher: async (h) => ({ events: day1[h] ?? [], badLines: 0 }) });
    const { rows } = await FinanceData.activity('2026-10-01T00:00:00Z', '2026-11-12T17:00:00Z');
    const coverage = { since: '2026-10-01T00:00:00.000Z', through: '2026-11-12T14:00:00.000Z' };

    const u: PmfUser = {
      userId: U1,
      signupAt: '2026-11-03T16:00:00Z',
      signupDate: '2026-11-03',
      timezone: 'America/New_York',
      platform: 'ios',
      channel: 'organic',
      onboardingCompleted: true,
      reachedPaywall: false,
      firstMealAt: null,
      events: [],
      virality: null,
    };
    const facts = (activitySince: string | null): PmfFacts => ({
      now: new Date('2026-11-12T17:00:00Z'),
      today: '2026-11-12',
      timeZone: 'America/New_York',
      users: [u],
      activity: new Map([[U1, rows.map((r) => Date.parse(r.at))]]),
      meals: new Map(),
      userPlatform: new Map([[U1, 'ios']]),
      spend: [],
      eventsByUser: new Map(),
      memberships: [],
      activitySince,
    });
    // Old signal (feed / app opens) started after this sign-up → not counted at all.
    const old = activitySinceOf({ amplitudeSince: null, amplitudeThrough: null, feedSince: '2026-11-09T00:00:00Z', opensSince: '2026-11-09T00:00:00Z' });
    expect(buildKpis(facts(old), 28).find((k) => k.id === 'd1_retention')!.current).toMatchObject({ n: 0 });
    const since = activitySinceOf({ amplitudeSince: coverage.since, amplitudeThrough: coverage.through, feedSince: '2026-11-09T00:00:00Z', opensSince: '2026-11-09T00:00:00Z' });
    expect(since).toBe(coverage.since);
    expect(buildKpis(facts(since), 28).find((k) => k.id === 'd1_retention')!.current).toMatchObject({ n: 1, numerator: 1, value: 100 });
  });
});

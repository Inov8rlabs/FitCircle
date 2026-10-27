import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';

import { setReleaseConnectorsForTest, type ReleaseConnector, type StoreSnapshot } from '../connectors';
import { ReleaseSyncService } from '../services/sync-service';
import type { ObservedRelease } from '../status';

let db: AdsFakeDb;
const o = (over: Partial<ObservedRelease>): ObservedRelease => ({
  releaseKey: 'ios:app_store:1.0.9',
  platform: 'ios',
  track: 'app_store',
  version: '1.0.9',
  build: '71',
  status: 'pending_release',
  storeStatus: 'PENDING_DEVELOPER_RELEASE',
  ...over,
});
const connector = (source: 'app_store_connect' | 'google_play', snap: () => StoreSnapshot | Promise<StoreSnapshot>, configured = true): ReleaseConnector => ({
  source,
  isConfigured: () => configured,
  fetchSnapshot: async () => snap(),
});

beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
  setReleaseConnectorsForTest(null);
});

describe('ReleaseSyncService.applySnapshot', () => {
  it('is idempotent: re-applying the same snapshot writes no new events', async () => {
    const snap = { releases: [o({})], completeTracks: [] };
    expect(await ReleaseSyncService.applySnapshot('app_store_connect', snap, new Date('2026-10-27T10:00:00Z'))).toEqual({ rowsReleases: 1, rowsEvents: 1 });
    expect(await ReleaseSyncService.applySnapshot('app_store_connect', snap, new Date('2026-10-27T11:00:00Z'))).toEqual({ rowsReleases: 1, rowsEvents: 0 });
    expect(db.rows('releases')).toHaveLength(1);
    expect(db.rows('release_events')).toHaveLength(1);
  });

  it('appends one event per status change and keeps admin notes', async () => {
    await ReleaseSyncService.applySnapshot('app_store_connect', { releases: [o({})], completeTracks: [] }, new Date('2026-10-27T10:00:00Z'));
    Object.assign(db.rows('releases')[0], { internal_notes: 'Ani: hold for Duo fix', commits: [{ sha: 'abc1234', subject: 'x' }] });
    await ReleaseSyncService.applySnapshot('app_store_connect', { releases: [o({ status: 'live', storeStatus: 'READY_FOR_DISTRIBUTION' })], completeTracks: [] }, new Date('2026-10-27T12:00:00Z'));
    const row = db.rows('releases')[0];
    expect(row).toMatchObject({ status: 'live', internal_notes: 'Ani: hold for Duo fix', released_at: '2026-10-27T12:00:00.000Z' });
    expect(row.commits).toHaveLength(1);
    const events = db.rows('release_events').map((e) => `${e.from_status}->${e.to_status}`);
    expect(events).toEqual(['null->pending_release', 'pending_release->live']);
  });

  it('supersedes current rows that dropped off a fully-listed Play track', async () => {
    const live19 = o({ releaseKey: 'android:play_production:19', platform: 'android', track: 'play_production', version: '1.0.7', build: '19', status: 'live', storeStatus: 'completed' });
    const live36 = { ...live19, releaseKey: 'android:play_production:36', version: '1.0.9', build: '36' };
    await ReleaseSyncService.applySnapshot('google_play', { releases: [live19], completeTracks: ['android:play_production'] }, new Date('2026-10-22T10:00:00Z'));
    await ReleaseSyncService.applySnapshot('google_play', { releases: [live36], completeTracks: ['android:play_production'] }, new Date('2026-10-27T10:00:00Z'));
    const byKey = Object.fromEntries(db.rows('releases').map((r) => [r.release_key, r]));
    expect(byKey['android:play_production:19']).toMatchObject({ status: 'superseded', superseded_at: '2026-10-27T10:00:00.000Z' });
    expect(byKey['android:play_production:36']!.status).toBe('live');
    expect(db.rows('release_events').filter((e) => e.to_status === 'superseded')).toHaveLength(1);
  });
});

describe('ReleaseSyncService.run', () => {
  it('one failing store does not block the other; unconfigured is skipped; one run row per source', async () => {
    setReleaseConnectorsForTest({
      app_store_connect: connector('app_store_connect', () => ({ releases: [o({})], completeTracks: [] })),
      google_play: connector('google_play', () => {
        throw new Error('Google Play POST /edits: The caller does not have permission');
      }),
    });
    const results = await ReleaseSyncService.run({ trigger: 'manual' });
    expect(results.find((r) => r.source === 'app_store_connect')).toMatchObject({ ok: true, rowsReleases: 1, rowsEvents: 1 });
    expect(results.find((r) => r.source === 'google_play')).toMatchObject({ ok: false, error: expect.stringContaining('permission') });
    expect(db.rows('release_sync_runs').map((r) => [r.source, r.ok])).toEqual([
      ['app_store_connect', true],
      ['google_play', false],
    ]);

    setReleaseConnectorsForTest({ google_play: connector('google_play', () => ({ releases: [], completeTracks: [] }), false) });
    expect(await ReleaseSyncService.run({ sources: ['google_play'] })).toEqual([expect.objectContaining({ source: 'google_play', ok: false, skipped: 'not_configured' })]);
  });

  it('debounces manual syncs within 2 minutes', async () => {
    setReleaseConnectorsForTest({ app_store_connect: connector('app_store_connect', () => ({ releases: [], completeTracks: [] })) });
    await ReleaseSyncService.run({ sources: ['app_store_connect'], trigger: 'manual' });
    const again = await ReleaseSyncService.run({ sources: ['app_store_connect'], trigger: 'manual', debounce: true });
    expect(again[0]).toMatchObject({ skipped: 'debounced' });
  });
});

import { describe, expect, it } from 'vitest';

import { computeLiveNow, rowToRelease, sortTimeline } from '../model';
import {
  ascVersionStatus,
  compareReleases,
  compareVersions,
  phasedFraction,
  planRelease,
  playStatus,
  playTrackName,
  playVersionFromName,
  releaseKey,
  supersedeOlderLive,
  testflightStatus,
  type ExistingRelease,
  type ObservedRelease,
} from '../status';
import type { Release } from '../types';

describe('store state mapping', () => {
  it.each([
    ['READY_FOR_DISTRIBUTION', 'live'],
    ['READY_FOR_SALE', 'live'],
    ['PENDING_DEVELOPER_RELEASE', 'pending_release'],
    ['ACCEPTED', 'pending_release'],
    ['IN_REVIEW', 'in_review'],
    ['WAITING_FOR_REVIEW', 'waiting_for_review'],
    ['REJECTED', 'rejected'],
    ['METADATA_REJECTED', 'rejected'],
    ['DEVELOPER_REJECTED', 'developer_rejected'],
    ['REPLACED_WITH_NEW_VERSION', 'superseded'],
    ['PREPARE_FOR_SUBMISSION', 'draft'],
    ['SOMETHING_NEW', 'draft'],
    [null, 'draft'],
  ])('ASC %s → %s', (state, status) => expect(ascVersionStatus(state)).toBe(status));

  it('maps TestFlight builds', () => {
    expect(testflightStatus({ processingState: 'PROCESSING' })).toBe('processing');
    expect(testflightStatus({ processingState: 'VALID', expired: true })).toBe('expired');
    expect(testflightStatus({ processingState: 'VALID', internalBuildState: 'IN_BETA_TESTING' })).toBe('in_testing');
    expect(testflightStatus({ processingState: 'FAILED' })).toBe('removed');
  });

  it('maps Play statuses per track', () => {
    expect(playStatus('completed', 'production')).toBe('live');
    expect(playStatus('inProgress', 'production')).toBe('rolling_out');
    expect(playStatus('completed', 'internal')).toBe('in_testing');
    expect(playStatus('halted', 'production')).toBe('halted');
    expect(playStatus('draft', 'production')).toBe('draft');
    expect(playTrackName('production')).toBe('play_production');
    expect(playTrackName('Closed Testing - QA')).toBe('play_closed_testing_qa');
  });

  it('parses Play release names', () => {
    expect(playVersionFromName('16 (1.0.5)', '16')).toBe('1.0.5');
    expect(playVersionFromName('1.0.9', '36')).toBe('1.0.9');
    expect(playVersionFromName('', '36')).toBe('36');
    expect(playVersionFromName('Holiday build', '40')).toBe('Holiday build');
  });

  it('follows Apple phased release days', () => {
    expect(phasedFraction(1)).toBe(0.01);
    expect(phasedFraction(6)).toBe(0.5);
    expect(phasedFraction(12)).toBe(1);
    expect(phasedFraction(0)).toBeNull();
  });
});

describe('ordering + keys', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1);
    expect(compareReleases({ version: '1.0.7', build: '66' }, { version: '1.0.7', build: '64' })).toBe(1);
  });

  it('builds stable keys', () => {
    expect(releaseKey({ platform: 'ios', track: 'app_store', version: '1.0.9', build: '71' })).toBe('ios:app_store:1.0.9');
    expect(releaseKey({ platform: 'ios', track: 'testflight', version: '1.1.0', build: '72' })).toBe('ios:testflight:1.1.0(72)');
    expect(releaseKey({ platform: 'android', track: 'play_production', version: '1.0.9', build: '36' })).toBe('android:play_production:36');
    expect(releaseKey({ platform: 'backend', track: 'production', version: '2026-10-27', build: '517d8e1' })).toBe('backend:production:517d8e1');
  });

  it('only the newest READY_FOR_SALE App Store version is live', () => {
    const out = supersedeOlderLive([
      { version: '1.0.8', build: '70', status: 'live' as const },
      { version: '1.0.9', build: '71', status: 'live' as const },
      { version: '1.1.0', build: '72', status: 'draft' as const },
    ]);
    expect(out.map((r) => r.status)).toEqual(['superseded', 'live', 'draft']);
  });
});

const obs = (over: Partial<ObservedRelease> = {}): ObservedRelease => ({
  releaseKey: 'ios:app_store:1.1.0',
  platform: 'ios',
  track: 'app_store',
  version: '1.1.0',
  build: '72',
  status: 'waiting_for_review',
  storeStatus: 'WAITING_FOR_REVIEW',
  submittedAt: '2026-10-27T10:00:00.000Z',
  ...over,
});
const existing = (over: Partial<ExistingRelease> = {}): ExistingRelease => ({
  id: 'r1',
  release_key: 'ios:app_store:1.1.0',
  status: 'waiting_for_review',
  store_created_at: null,
  uploaded_at: null,
  submitted_at: '2026-10-27T10:00:00.000Z',
  approved_at: null,
  released_at: null,
  superseded_at: null,
  whats_new: 'Old notes',
  ...over,
});
const NOW = '2026-10-28T12:00:00.000Z';

describe('planRelease (status-change events)', () => {
  it('new row: one "first seen" event, no invented milestone dates', () => {
    const p = planRelease(null, obs({ status: 'live', storeStatus: 'READY_FOR_DISTRIBUTION' }), 'app_store_connect', NOW);
    expect(p.event).toMatchObject({ from_status: null, to_status: 'live', occurred_at: NOW, note: 'first seen by sync' });
    expect(p.row.released_at).toBeNull();
    expect(p.row.approved_at).toBeNull();
  });

  it('unchanged status: no event (idempotent)', () => {
    const p = planRelease(existing(), obs(), 'app_store_connect', NOW);
    expect(p.event).toBeNull();
  });

  it('status change stamps milestones once and logs from → to', () => {
    const approved = planRelease(existing(), obs({ status: 'pending_release', storeStatus: 'PENDING_DEVELOPER_RELEASE' }), 'app_store_connect', NOW);
    expect(approved.event).toMatchObject({ from_status: 'waiting_for_review', to_status: 'pending_release' });
    expect(approved.row.approved_at).toBe(NOW);
    const live = planRelease(existing({ status: 'pending_release', approved_at: '2026-10-28T01:00:00.000Z' }), obs({ status: 'live' }), 'app_store_connect', NOW);
    expect(live.row.approved_at).toBe('2026-10-28T01:00:00.000Z');
    expect(live.row.released_at).toBe(NOW);
    const sup = planRelease(existing({ status: 'live', released_at: '2026-10-20T00:00:00.000Z' }), obs({ status: 'superseded' }), 'app_store_connect', NOW);
    expect(sup.row.released_at).toBe('2026-10-20T00:00:00.000Z');
    expect(sup.row.superseded_at).toBe(NOW);
  });

  it('never writes admin-owned columns and keeps stored whatsNew when the store returns none', () => {
    const p = planRelease(existing(), obs({ whatsNew: null }), 'app_store_connect', NOW);
    for (const col of ['internal_notes', 'known_issues', 'commits', 'migrations', 'links', 'notes_updated_by']) expect(p.row).not.toHaveProperty(col);
    expect(p.row.whats_new).toBe('Old notes');
  });

  it('uses the store-provided status time when given', () => {
    const p = planRelease(existing(), obs({ status: 'in_review', statusAt: '2026-10-28T03:00:00.000Z' }), 'app_store_connect', NOW);
    expect(p.event?.occurred_at).toBe('2026-10-28T03:00:00.000Z');
  });
});

const rel = (over: Partial<Release>): Release =>
  rowToRelease({
    id: over.id ?? Math.random().toString(36),
    release_key: 'k',
    platform: 'ios',
    track: 'app_store',
    version: '1.0.0',
    build: '1',
    status: 'live',
    source: 'backfill',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`), v])),
  });

describe('live now', () => {
  it('picks live / in review / ahead-of-live testing per platform', () => {
    const list = [
      rel({ version: '1.0.8', build: '70', status: 'superseded' }),
      rel({ version: '1.0.9', build: '71', status: 'live' }),
      rel({ version: '1.1.0', build: '72', status: 'waiting_for_review' }),
      rel({ track: 'testflight', version: '1.1.0', build: '72', status: 'in_testing' }),
      rel({ track: 'testflight', version: '1.0.9', build: '71', status: 'in_testing' }),
      rel({ platform: 'android', track: 'play_production', version: '1.0.9', build: '36', status: 'live' }),
      rel({ platform: 'android', track: 'play_internal', version: '1.0.9', build: '36', status: 'in_testing' }),
      rel({ platform: 'backend', track: 'production', version: '2026-10-27', build: 'abc1234', status: 'live' }),
    ];
    const [ios, android, backend] = computeLiveNow(list);
    expect(ios.live?.version).toBe('1.0.9');
    expect(ios.inReview?.version).toBe('1.1.0');
    expect(ios.inTesting?.build).toBe('72');
    expect(android.live?.build).toBe('36');
    expect(android.inTesting).toBeNull(); // same build as live
    expect(backend.live?.build).toBe('abc1234');
  });

  it('sorts the timeline newest first', () => {
    const a = rel({ id: 'a', releasedAt: '2026-10-20T00:00:00Z' });
    const b = rel({ id: 'b', releasedAt: '2026-10-27T00:00:00Z' });
    const c = rel({ id: 'c', submittedAt: '2026-10-28T00:00:00Z', status: 'waiting_for_review' });
    expect(sortTimeline([a, b, c]).map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });
});

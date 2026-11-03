/** Release commit SHAs: Xcode Cloud (iOS), fill-if-empty rules, backend self-registration. */
import { generateKeyPairSync } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Under jsdom, TextEncoder output and Uint8Array come from different realms and
// jose (ASC JWT) rejects it; install an encoder before jose loads (see campaigns app-store.test).
vi.hoisted(() => {
  (globalThis as any).TextEncoder = class {
    readonly encoding = 'utf-8';
    encode(input = '') {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  };
});

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';

import { AppStoreReleasesConnector, attachCiCommits, mapCiBuildRuns } from '../connectors/app-store';
import { parseAndroidCommitFile, recordAndroidCommits } from '../services/android-commits';
import { ensureRunningBackendRelease, runningDeploymentFromEnv } from '../services/backend-release';
import { ReleaseSyncService } from '../services/sync-service';
import { planFill, type ObservedRelease } from '../status';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = '93cd2296892b9af9371f0b286bd9edb5f9a93bd1';

const run = (id: string, number: number, over: Record<string, unknown> = {}, sha = SHA_A) => ({
  type: 'ciBuildRuns',
  id,
  attributes: {
    number,
    completionStatus: 'SUCCEEDED',
    startedDate: '2026-11-03T18:38:47.115Z',
    finishedDate: '2026-11-03T19:08:53.714Z',
    sourceCommit: { commitSha: sha, message: 'Bump MARKETING_VERSION to 1.1.2\n\nbody line', author: { displayName: 'Ani' }, webUrl: `https://github.com/Inov8rlabs/FitCircle-iOS/commit/${sha}` },
    ...over,
  },
});

const tf = (build: string, uploadedAt: string | null, over: Partial<ObservedRelease> = {}): ObservedRelease => ({
  releaseKey: `ios:testflight:1.1.2(${build})`,
  platform: 'ios',
  track: 'testflight',
  version: '1.1.2',
  build,
  status: 'in_testing',
  storeStatus: 'VALID',
  uploadedAt,
  ...over,
});

let db: AdsFakeDb;
beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
});

describe('Xcode Cloud runs → iOS commits', () => {
  it('keeps only SUCCEEDED runs with a full sha; subject is the first line; date is the run day', () => {
    const runs = mapCiBuildRuns({
      data: [run('r87', 87), run('r86', 86, { completionStatus: 'FAILED' }), run('r85', 85, { sourceCommit: { commitSha: 'abc1234' } })],
    });
    expect([...runs.keys()]).toEqual(['87']);
    expect(runs.get('87')![0].commit).toEqual({ sha: SHA_A, subject: 'Bump MARKETING_VERSION to 1.1.2', repo: 'FitCircle-iOS', date: '2026-11-03' });
  });

  it('matches build number = run number only when the upload falls in the run window', () => {
    const runs = mapCiBuildRuns({ data: [run('r87', 87), run('r60', 60, { startedDate: '2026-10-21T20:24:32Z', finishedDate: '2026-10-21T20:49:09Z' })] });
    const out = attachCiCommits(
      [
        tf('87', '2026-11-03T19:01:00Z'),
        // A local upload that reused number 60 a day before the cloud run.
        tf('60', '2026-10-20T16:38:52Z'),
        tf('99', '2026-11-03T19:01:00Z'),
        { ...tf('87', null), releaseKey: 'android:play_internal:87', platform: 'android', track: 'play_internal' },
      ],
      runs
    );
    expect(out[0].commits).toEqual([expect.objectContaining({ sha: SHA_A })]);
    expect(out[0].links).toEqual({ xcode_cloud: `https://github.com/Inov8rlabs/FitCircle-iOS/commit/${SHA_A}` });
    expect(out[1].commits).toBeUndefined();
    expect(out[2].commits).toBeUndefined();
    expect(out[3].commits).toBeUndefined();
  });

  it('connector reads ciProducts then buildRuns (GET only) and attaches commits; a CI failure never fails the sync', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    vi.stubEnv('ASC_KEY_ID', 'KEY');
    vi.stubEnv('ASC_ISSUER_ID', 'ISS');
    vi.stubEnv('ASC_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    vi.stubEnv('ASC_APP_ID', '6811432467');
    const calls: string[] = [];
    let ciFails = false;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.appstoreconnect.apple.com', '')}`);
      if (url.includes('/ciProducts?')) return ciFails ? Response.json({ errors: [{ detail: 'Forbidden' }] }, { status: 403 }) : Response.json({ data: [{ id: 'P1', attributes: { productType: 'APP' } }] });
      if (url.includes('/buildRuns')) return Response.json({ data: [run('r87', 87, {}, SHA_C)] });
      if (url.includes('/v1/builds?'))
        return Response.json({
          data: [{ id: 'b87', attributes: { version: '87', processingState: 'VALID', uploadedDate: '2026-11-03T11:59:00-08:00' }, relationships: { preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'pre' } } } }],
          included: [{ type: 'preReleaseVersions', id: 'pre', attributes: { version: '1.1.2', platform: 'IOS' } }],
        });
      return Response.json({ data: [] });
    });
    try {
      const snap = await new AppStoreReleasesConnector(fetchMock as any).fetchSnapshot();
      expect(snap.releases[0]).toMatchObject({ releaseKey: 'ios:testflight:1.1.2(87)', commits: [{ sha: SHA_C, repo: 'FitCircle-iOS' }] });
      expect(calls).toContain('GET /v1/ciProducts?filter[app]=6811432467&limit=10');
      expect(calls.some((c) => c.startsWith('GET /v1/ciProducts/P1/buildRuns?sort=-number&limit=200'))).toBe(true);
      expect(calls.every((c) => c.startsWith('GET '))).toBe(true);

      ciFails = true;
      const again = await new AppStoreReleasesConnector(fetchMock as any).fetchSnapshot();
      expect(again.releases[0].commits).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('fill-if-empty (sync)', () => {
  const commit = { sha: SHA_A, subject: 'cloud', repo: 'FitCircle-iOS', date: '2026-11-03' };

  it('planFill: commits only into an empty list, links only for absent keys', () => {
    expect(planFill(null, { commits: [commit] })).toEqual({ commits: [commit] });
    expect(planFill({ commits: [{ sha: SHA_B, subject: 'admin' }] }, { commits: [commit] })).toBeNull();
    expect(planFill({ commits: [], links: { xcode_cloud: 'https://x/1' } }, { links: { xcode_cloud: 'https://x/2' } })).toBeNull();
    expect(planFill({ commits: [], links: { pr: 'https://x/pr' } }, { links: { xcode_cloud: 'https://x/2' } })).toEqual({ links: { pr: 'https://x/pr', xcode_cloud: 'https://x/2' } });
  });

  it('fills an empty row once, is idempotent, and never overwrites admin commits, links or notes', async () => {
    const obs = tf('87', '2026-11-03T19:01:00Z', { commits: [commit], links: { xcode_cloud: 'https://github.com/x/commit/a' } });
    await ReleaseSyncService.applySnapshot('app_store_connect', { releases: [obs], completeTracks: [] }, new Date('2026-11-03T20:00:00Z'));
    const row = db.rows('releases')[0];
    expect(row.commits).toEqual([commit]);
    expect(row.links).toEqual({ xcode_cloud: 'https://github.com/x/commit/a' });

    // Admin edits; the next sync must keep them.
    Object.assign(row, { commits: [{ sha: SHA_B, subject: 'admin picked' }], links: { xcode_cloud: 'https://admin/link' }, internal_notes: 'keep me' });
    const res = await ReleaseSyncService.applySnapshot('app_store_connect', { releases: [obs], completeTracks: [] }, new Date('2026-11-03T21:00:00Z'));
    expect(res.rowsEvents).toBe(0);
    expect(db.rows('releases')[0]).toMatchObject({ commits: [{ sha: SHA_B, subject: 'admin picked' }], links: { xcode_cloud: 'https://admin/link' }, internal_notes: 'keep me' });
  });

  it('fills an existing backfilled row whose commits are empty, without touching notes', async () => {
    db.rows('releases').push({ id: 'r1', release_key: 'ios:testflight:1.1.2(87)', platform: 'ios', track: 'testflight', version: '1.1.2', build: '87', status: 'in_testing', commits: [], links: { pr: 'https://x/pr' }, internal_notes: 'notes' });
    await ReleaseSyncService.applySnapshot('app_store_connect', { releases: [tf('87', null, { commits: [commit], links: { xcode_cloud: 'https://x/c' } })], completeTracks: [] });
    expect(db.rows('releases')[0]).toMatchObject({ commits: [commit], links: { pr: 'https://x/pr', xcode_cloud: 'https://x/c' }, internal_notes: 'notes' });
  });

  it('the guarded write loses to an admin edit made after the read', async () => {
    db.rows('releases').push({ id: 'r1', release_key: 'k', commits: [{ sha: SHA_B, subject: 'admin' }], links: {} });
    const { applyFill } = await import('../services/sync-service');
    await applyFill('r1', { commits: [commit], links: { xcode_cloud: 'https://x' } }, { pr: 'stale read' }, '2026-11-03T00:00:00Z');
    expect(db.rows('releases')[0]).toMatchObject({ commits: [{ sha: SHA_B, subject: 'admin' }], links: {} });
  });
});

describe('backend self-registration', () => {
  const env = (sha: string, over: Record<string, string> = {}) =>
    ({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: sha, VERCEL_GIT_COMMIT_MESSAGE: 'Fix lint in the home feed\n\nmore', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_DEPLOYMENT_ID: 'dpl_123', ...over }) as unknown as NodeJS.ProcessEnv;

  it('only runs on a production deploy with a full git sha', () => {
    expect(runningDeploymentFromEnv(env(SHA_A, { VERCEL_ENV: 'preview' }))).toBeNull();
    expect(runningDeploymentFromEnv(env('abc1234'))).toBeNull();
    expect(runningDeploymentFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(runningDeploymentFromEnv(env(SHA_A))).toMatchObject({ shortSha: 'aaaaaaa', subject: 'Fix lint in the home feed', ref: 'main', deploymentId: 'dpl_123' });
  });

  it('creates the live row in the manual rows format, supersedes the previous live row, and is idempotent', async () => {
    db.rows('releases').push({ id: 'old', release_key: 'backend:production:bbbbbbb', platform: 'backend', track: 'production', version: '2026-11-02', build: 'bbbbbbb', status: 'live', commits: [{ sha: SHA_B, subject: 'x' }], links: {}, internal_notes: 'old notes' });
    const now = new Date('2026-11-03T17:49:00Z');
    expect(await ensureRunningBackendRelease({ env: env(SHA_A), now })).toEqual({ status: 'created', releaseKey: 'backend:production:aaaaaaa', superseded: 1 });

    const by = Object.fromEntries(db.rows('releases').map((r) => [r.release_key, r]));
    expect(by['backend:production:aaaaaaa']).toMatchObject({
      platform: 'backend',
      track: 'production',
      version: '2026-11-03',
      build: 'aaaaaaa',
      status: 'live',
      source: 'git',
      source_id: 'dpl_123',
      released_at: '2026-11-03T17:49:00.000Z',
      commits: [{ sha: SHA_A, subject: 'Fix lint in the home feed', repo: 'FitCircleBE', date: '2026-11-03' }],
      migrations: [],
      links: { commit: `https://github.com/Inov8rlabs/FitCircleBE/commit/${SHA_A}` },
    });
    expect(by['backend:production:aaaaaaa'].internal_notes).toBeUndefined();
    expect(by['backend:production:bbbbbbb']).toMatchObject({ status: 'superseded', superseded_at: '2026-11-03T17:49:00.000Z', internal_notes: 'old notes' });
    expect(db.rows('release_events').map((e) => `${e.from_status}->${e.to_status}`)).toEqual(['null->live', 'live->superseded']);

    // Every later cron / admin request: no writes.
    expect(await ensureRunningBackendRelease({ env: env(SHA_A), now: new Date('2026-11-03T18:35:00Z') })).toMatchObject({ status: 'exists' });
    expect(db.rows('releases')).toHaveLength(2);
    expect(db.rows('release_events')).toHaveLength(2);
    expect(by['backend:production:aaaaaaa'].released_at).toBe('2026-11-03T17:49:00.000Z');
  });

  it('a row added by hand first only gets empty commits / missing link filled; status, notes and admin commits stay', async () => {
    db.rows('releases').push({ id: 'm1', release_key: 'backend:production:aaaaaaa', platform: 'backend', track: 'production', version: '2026-11-03', build: 'aaaaaaa', status: 'live', source: 'manual', commits: [], links: {}, internal_notes: 'hand notes' });
    expect(await ensureRunningBackendRelease({ env: env(SHA_A) })).toMatchObject({ status: 'filled' });
    expect(db.rows('releases')[0]).toMatchObject({ status: 'live', source: 'manual', internal_notes: 'hand notes', commits: [expect.objectContaining({ sha: SHA_A, repo: 'FitCircleBE' })] });

    db.rows('releases')[0].commits = [{ sha: SHA_A, subject: 'admin wording' }];
    expect(await ensureRunningBackendRelease({ env: env(SHA_A) })).toMatchObject({ status: 'exists' });
    expect(db.rows('releases')[0].commits).toEqual([{ sha: SHA_A, subject: 'admin wording' }]);
    expect(db.rows('release_events')).toHaveLength(0);
  });

  it('a rollback to an already-known sha changes nothing; preview deploys are skipped', async () => {
    db.rows('releases').push({ id: 'o', release_key: 'backend:production:bbbbbbb', platform: 'backend', track: 'production', build: 'bbbbbbb', status: 'superseded', commits: [{ sha: SHA_B, subject: 'x' }], links: { commit: 'https://x' } });
    expect(await ensureRunningBackendRelease({ env: env(SHA_B) })).toMatchObject({ status: 'exists' });
    expect(db.rows('releases')[0].status).toBe('superseded');
    expect(await ensureRunningBackendRelease({ env: env(SHA_A, { VERCEL_ENV: 'preview' }) })).toMatchObject({ status: 'skipped' });
    expect(db.rows('releases')).toHaveLength(1);
  });
});

describe('Android commits (releases/<N>/COMMIT)', () => {
  const file = `${SHA_A}\n2026-11-03\nAndroid 1.1.2 versionCode 49\n`;
  const commit = { sha: SHA_A, subject: 'Android 1.1.2 versionCode 49', repo: 'Fitcircle-Android', date: '2026-11-03' };
  const play = (track: string, build: string, over: Record<string, unknown> = {}) => ({ id: `${track}${build}`, release_key: `android:${track}:${build}`, platform: 'android', track, version: '1.1.2', build, status: 'in_testing', commits: [], links: {}, ...over });

  it('parses the file; rejects short shas; marks dirty builds', () => {
    expect(parseAndroidCommitFile(file)).toEqual(commit);
    expect(parseAndroidCommitFile(`abc1234\n2026-11-03\nx`)).toBeNull();
    expect(parseAndroidCommitFile(`${file}dirty\n`)?.subject).toBe('Android 1.1.2 versionCode 49 (built from a dirty tree)');
  });

  it('fills every android row with that versionCode, only when empty; idempotent; notes untouched', async () => {
    db.rows('releases').push(play('play_internal', '49', { internal_notes: 'n' }), play('firebase_dev', '49'), play('play_internal', '48', { commits: [{ sha: SHA_B, subject: 'admin' }] }));
    const res = await recordAndroidCommits([
      { build: '49', commit },
      { build: '48', commit },
    ]);
    expect(res).toEqual([
      { build: '49', filled: ['android:play_internal:49', 'android:firebase_dev:49'], kept: [] },
      { build: '48', filled: [], kept: ['android:play_internal:48'] },
    ]);
    const by = Object.fromEntries(db.rows('releases').map((r) => [r.release_key, r]));
    expect(by['android:play_internal:49']).toMatchObject({ commits: [commit], internal_notes: 'n' });
    expect(by['android:play_internal:48'].commits).toEqual([{ sha: SHA_B, subject: 'admin' }]);
    expect((await recordAndroidCommits([{ build: '49', commit }]))[0].filled).toEqual([]);
  });

  it('the sync copies commits to a new track row from a sibling with the same versionCode', async () => {
    db.rows('releases').push(play('play_internal', '49', { commits: [commit] }));
    const prod: ObservedRelease = { releaseKey: 'android:play_production:49', platform: 'android', track: 'play_production', version: '1.1.2', build: '49', status: 'rolling_out', storeStatus: 'inProgress' };
    await ReleaseSyncService.applySnapshot('google_play', { releases: [prod], completeTracks: [] });
    expect(db.rows('releases').find((r) => r.release_key === 'android:play_production:49')!.commits).toEqual([commit]);
  });
});

afterEach(() => vi.unstubAllEnvs());

/** /api/admin/releases/** contract + auth, /api/cron/releases/sync auth. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getAdsDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { setReleaseConnectorsForTest } from '@/lib/releases/connectors';

import { GET as cronSync } from '../../../cron/releases/sync/route';
import { GET as getOne, PATCH as patchOne } from '../[id]/route';
import { GET as list, POST as create } from '../route';
import { POST as syncNow } from '../sync/route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SECRET = 'admin-secret-for-tests';
let db: AdsFakeDb;

const req = (url: string, opts: { as?: string; auth?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      ...(opts.auth ? { authorization: opts.auth } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const secret = { auth: `Bearer ${SECRET}`, headers: { 'x-admin-actor': 'ani@inov8rlabs.com' } };

beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
  db.rows('profiles').push({ id: ADMIN, email: 'ani@inov8rlabs.com', is_admin: true }, { id: USER, email: 'u@x.com', is_admin: false });
  vi.stubEnv('ADMIN_API_SECRET', SECRET);
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  setReleaseConnectorsForTest({
    app_store_connect: { source: 'app_store_connect', isConfigured: () => true, fetchSnapshot: async () => ({ releases: [], completeTracks: [] }) },
    google_play: { source: 'google_play', isConfigured: () => false, fetchSnapshot: async () => ({ releases: [], completeTracks: [] }) },
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setReleaseConnectorsForTest(null);
});

describe('auth', () => {
  it('rejects anonymous (401) and non-admins (403)', async () => {
    expect((await list(req('/api/admin/releases'))).status).toBe(401);
    expect((await list(req('/api/admin/releases', { as: USER }))).status).toBe(403);
    expect((await list(req('/api/admin/releases', { as: ADMIN }))).status).toBe(200);
  });

  it('secret mutations must name the actor', async () => {
    const res = await create(req('/api/admin/releases', { method: 'POST', auth: `Bearer ${SECRET}`, body: { platform: 'backend', track: 'production', version: '2026-10-27', build: 'abc1234', status: 'live' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_actor');
  });

  it('cron sync requires CRON_SECRET', async () => {
    expect((await cronSync(req('/api/cron/releases/sync'))).status).toBe(401);
    const ok = await cronSync(req('/api/cron/releases/sync', { auth: 'Bearer cron-secret' }));
    expect(ok.status).toBe(200);
    expect(db.rows('release_sync_runs')).toHaveLength(1); // google_play not configured → no run row
  });
});

describe('manual releases + edits', () => {
  it('creates a backend release, supersedes the previous live one, lists it, rejects duplicates', async () => {
    const first = await create(req('/api/admin/releases', { method: 'POST', ...secret, body: { platform: 'backend', track: 'production', version: '2026-10-26', build: '1111111', status: 'live', releasedAt: '2026-10-26T12:00:00Z' } }));
    expect(first.status).toBe(201);
    const second = await create(req('/api/admin/releases', { method: 'POST', ...secret, body: { platform: 'backend', track: 'production', version: '2026-10-27', build: '2222222', status: 'live', migrations: ['111_releases_tracker'], internalNotes: '- Releases tracker' } }));
    const body = (await second.json()).data;
    expect(body.release).toMatchObject({ releaseKey: 'backend:production:2222222', status: 'live', migrations: ['111_releases_tracker'], notesUpdatedBy: 'ani@inov8rlabs.com' });
    expect(body.events[0]).toMatchObject({ toStatus: 'live', source: 'manual', actor: 'ani@inov8rlabs.com' });
    expect(db.rows('releases').find((r) => r.build === '1111111')).toMatchObject({ status: 'superseded' });

    const dup = await create(req('/api/admin/releases', { method: 'POST', ...secret, body: { platform: 'backend', track: 'production', version: 'x', build: '2222222', status: 'live' } }));
    expect(dup.status).toBe(409);

    const listed = (await (await list(req('/api/admin/releases?platform=backend', secret))).json()).data;
    expect(listed.releases.map((r: any) => r.build)).toEqual(['2222222', '1111111']);
    expect(listed.liveNow.find((l: any) => l.platform === 'backend').live.build).toBe('2222222');
    expect(listed.sync.map((s: any) => [s.source, s.configured])).toEqual([
      ['app_store_connect', true],
      ['google_play', false],
    ]);
  });

  it('PATCH edits notes and links, validates input, records a manual status change', async () => {
    const created = (await (await create(req('/api/admin/releases', { method: 'POST', ...secret, body: { platform: 'web', track: 'production', version: '1', build: 'abcdef1', status: 'in_testing' } }))).json()).data.release;
    const res = await patchOne(req(`/api/admin/releases/${created.id}`, { method: 'PATCH', ...secret, body: { internalNotes: '## Shipped\n- thing', links: { PR: 'https://github.com/x/y/pull/1' }, status: 'live', note: 'promoted' } }), params(created.id));
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d.release).toMatchObject({ internalNotes: '## Shipped\n- thing', links: { PR: 'https://github.com/x/y/pull/1' }, status: 'live' });
    expect(d.release.releasedAt).toBeTruthy();
    expect(d.events.find((e: any) => e.toStatus === 'live')).toMatchObject({ fromStatus: 'in_testing', note: 'promoted', source: 'manual' });

    const bad = await patchOne(req(`/api/admin/releases/${created.id}`, { method: 'PATCH', ...secret, body: { links: { x: 'javascript:alert(1)' } } }), params(created.id));
    expect(bad.status).toBe(400);
    const unknown = await patchOne(req(`/api/admin/releases/${created.id}`, { method: 'PATCH', ...secret, body: { status: 'shipped' } }), params(created.id));
    expect(unknown.status).toBe(400);
    const extra = await patchOne(req(`/api/admin/releases/${created.id}`, { method: 'PATCH', ...secret, body: { source: 'app_store_connect' } }), params(created.id));
    expect(extra.status).toBe(400);
    expect((await getOne(req('/api/admin/releases/not-a-uuid', secret), params('not-a-uuid'))).status).toBe(404);
  });

  it('sync now runs configured stores and reports status', async () => {
    const res = await syncNow(req('/api/admin/releases/sync', { method: 'POST', ...secret, body: {} }));
    const d = (await res.json()).data;
    expect(d.results.map((r: any) => [r.source, r.ok, r.skipped ?? null])).toEqual([
      ['app_store_connect', true, null],
      ['google_play', false, 'not_configured'],
    ]);
    expect((await syncNow(req('/api/admin/releases/sync', { method: 'POST', ...secret, body: { source: 'firebase' } }))).status).toBe(400);
  });
});

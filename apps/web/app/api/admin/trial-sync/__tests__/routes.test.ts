/** /api/admin/trial-sync{,/plan,/apply}: auth, actor, zod validation, envelope, PLAN_STALE (docs/TRIAL_SYNC.md §4). Stores are HTTP fakes. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).TextEncoder = class {
    readonly encoding = 'utf-8';
    encode(input = '') {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  };
});

import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { TrialSyncService } from '@/lib/services/trial-sync';
import { FakeAsc, FakePlay } from '@/lib/stores/__tests__/fake-stores';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as APPLY } from '../apply/route';
import { POST as PLAN } from '../plan/route';
import { GET as STATUS } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return { ...authedUser };
  }),
}));

const SECRET = 'admin-secret';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db: FakeSupabase;
let asc: FakeAsc;
let play: FakePlay;

beforeEach(() => {
  vi.stubEnv('ADMIN_API_SECRET', SECRET);
  db = new FakeSupabase({
    remote_config_rules: {},
    remote_config_defaults: { uniqueKey: ['config_key'], rows: [{ config_key: 'trial_days', value: 3, updated_by: null, updated_at: '2026-11-06T00:00:00Z' }] },
    remote_config_changes: {},
    profiles: { uniqueKey: ['id'], rows: [{ id: ADMIN, email: 'ani@inov8rlabs.com', is_admin: true }] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  asc = new FakeAsc();
  play = new FakePlay();
  const svc = new TrialSyncService({ asc: asc.client(), play: play.client(), now: () => new Date('2026-11-09T18:00:00Z'), env: { STRIPE_TRIAL_DAYS: '7' } });
  vi.spyOn(TrialSyncService, 'fromEnv').mockReturnValue(svc);
  authedUser = null;
  resetRemoteConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const secret = { authorization: `Bearer ${SECRET}`, 'x-admin-actor': 'ani@inov8rlabs.com' };
const req = (path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://api.test${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.headers ?? secret), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

describe('auth', () => {
  it('401 without auth, 403 for a non-admin, 200 for the secret', async () => {
    expect((await STATUS(req('/api/admin/trial-sync', { headers: {} }))).status).toBe(401);
    authedUser = { id: 'u', is_admin: false };
    expect((await STATUS(req('/api/admin/trial-sync', { headers: { authorization: 'Bearer user' } }))).status).toBe(403);
    expect((await STATUS(req('/api/admin/trial-sync'))).status).toBe(200);
  });

  it('apply with the secret must name the actor', async () => {
    const res = await APPLY(req('/api/admin/trial-sync/apply', { method: 'POST', body: { days: 7, planHash: 'a'.repeat(64) }, headers: { authorization: `Bearer ${SECRET}` } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_actor');
  });
});

describe('GET status', () => {
  it('returns the envelope with stores + remote config, no-store', async () => {
    const res = await STATUS(req('/api/admin/trial-sync'));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const { body } = await json(res);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ inSync: true, appStore: { days: 3 }, googlePlay: { days: 3 }, remoteConfig: { effective: { ios: 3, android: 3, web: 3 } } });
  });
});

describe('POST plan', () => {
  it('validates the body', async () => {
    for (const body of [{}, { days: '7' }, { days: 7.5 }, { days: 7, extra: 1 }]) {
      const { status, body: out } = await json(await PLAN(req('/api/admin/trial-sync/plan', { method: 'POST', body })));
      expect(status).toBe(400);
      expect(out.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns a dry-run plan; unsupported lengths come back invalid with an error', async () => {
    const { body } = await json(await PLAN(req('/api/admin/trial-sync/plan', { method: 'POST', body: { days: 7 } })));
    expect(body.data.valid).toBe(true);
    expect(body.data.steps.length).toBe(27);
    const bad = await json(await PLAN(req('/api/admin/trial-sync/plan', { method: 'POST', body: { days: 10 } })));
    expect(bad.status).toBe(200);
    expect(bad.body.data).toMatchObject({ valid: false, errors: [expect.stringMatching(/not supported/)] });
    expect(asc.writes()).toEqual([]);
  });
});

describe('POST apply', () => {
  it('validates planHash', async () => {
    const { status, body } = await json(await APPLY(req('/api/admin/trial-sync/apply', { method: 'POST', body: { days: 7, planHash: 'nope' } })));
    expect(status).toBe(400);
    expect(body.error.details.issues[0].path).toBe('planHash');
  });

  it('409 PLAN_STALE with the fresh plan when the hash does not match', async () => {
    const { status, body } = await json(await APPLY(req('/api/admin/trial-sync/apply', { method: 'POST', body: { days: 7, planHash: 'a'.repeat(64) } })));
    expect(status).toBe(409);
    expect(body.error.code).toBe('PLAN_STALE');
    expect(body.error.details.plan.planHash).toMatch(/^[0-9a-f]{64}$/);
    expect(asc.writes()).toEqual([]);
  });

  it('applies a fresh plan and records the actor', async () => {
    const plan = (await json(await PLAN(req('/api/admin/trial-sync/plan', { method: 'POST', body: { days: 7 } })))).body.data;
    const { status, body } = await json(await APPLY(req('/api/admin/trial-sync/apply', { method: 'POST', body: { days: 7, planHash: plan.planHash } })));
    expect(status).toBe(200);
    expect(body.data).toMatchObject({ ok: true, remoteConfigChanged: true });
    expect(db.getRows('remote_config_changes').every((c) => c.actor === 'ani@inov8rlabs.com')).toBe(true);
  });
});

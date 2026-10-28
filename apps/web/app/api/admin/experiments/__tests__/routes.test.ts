/** /api/admin/experiments/** — auth, CRUD, overrides, release-gate, results, audit (ONBOARDING_V2 §6.4–§6.8). */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearResultsCache } from '@/lib/experiments/results-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { DELETE as DELETE_OVERRIDE, GET as GET_OVERRIDES, POST as POST_OVERRIDE } from '../[key]/overrides/route';
import { POST as RELEASE } from '../[key]/release-gate/route';
import { GET as RESULTS } from '../[key]/results/route';
import { GET as GET_ONE, PATCH as PATCH_ONE } from '../[key]/route';
import { GET as LIST, PATCH as PATCH_COLLECTION, POST as CREATE } from '../route';

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
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const QA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-12-31T00:00:00Z');
const DAY = 86_400_000;

const ARMS = [
  { key: 'control', weight: 20, payload: { flow: 'v1' } },
  { key: 'tour_hard', weight: 40, payload: { flow: 'v2', paywall: 'hard' } },
  { key: 'tour_soft', weight: 40, payload: { flow: 'v2', paywall: 'soft' } },
];

let db: FakeSupabase;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('ADMIN_API_SECRET', SECRET);
  clearResultsCache();
  db = new FakeSupabase({
    experiments: {
      uniqueKey: ['key'],
      rows: [
        {
          key: 'onboarding_v2',
          name: 'Onboarding v2',
          description: null,
          status: 'draft',
          salt: 'seeded-salt',
          arms: ARMS,
          traffic_pct: 20,
          audience: { platforms: ['ios', 'android'], minAppVersion: '1.2.0', newUsersOnly: true },
          fallback_arm: 'control',
          winner_arm: null,
          created_at: '2026-10-27T00:00:00Z',
        },
      ],
    },
    experiment_assignments: { uniqueKey: ['experiment_key', 'user_id'] },
    experiment_overrides: { uniqueKey: ['experiment_key', 'user_id'] },
    experiment_audit_log: {},
    profiles: {
      uniqueKey: ['id'],
      rows: [
        { id: ADMIN, email: 'ani@inov8rlabs.com', is_admin: true },
        { id: USER, email: 'user@example.com', is_admin: false, onboarding_gate: 'subscription_required' },
        { id: QA, email: 'QA@Example.com', is_admin: false, onboarding_gate: 'none' },
      ],
    },
    user_attribution: {},
    subscription_events: {},
    food_log_entries: {},
    streak_claims: {},
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  authedUser = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const secret = { authorization: `Bearer ${SECRET}`, 'x-admin-actor': 'ani@inov8rlabs.com' };
const req = (path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = { headers: secret }) =>
  new NextRequest(`https://api.test${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.headers ?? secret), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const params = (key: string) => ({ params: Promise.resolve({ key }) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const audit = () => db.getRows('experiment_audit_log');

describe('auth', () => {
  it('no auth → 401; non-admin session → 403; admin session and secret → 200', async () => {
    expect((await LIST(req('/api/admin/experiments', { headers: {} }))).status).toBe(401);
    authedUser = { id: USER, is_admin: false };
    expect((await LIST(req('/api/admin/experiments', { headers: { authorization: 'Bearer user' } }))).status).toBe(403);
    authedUser = { id: ADMIN, is_admin: true, email: 'ani@inov8rlabs.com' };
    expect((await LIST(req('/api/admin/experiments', { headers: { authorization: 'Bearer user' } }))).status).toBe(200);
    expect((await LIST(req('/api/admin/experiments'))).status).toBe(200);
  });

  it('secret writes must name the actor', async () => {
    const res = await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { trafficPct: 50 }, headers: { authorization: `Bearer ${SECRET}` } }), params('onboarding_v2'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_actor');
  });
});

describe('list / detail / create', () => {
  it('lists without the salt, with per-arm counts', async () => {
    db.seed('experiment_assignments', [
      { experiment_key: 'onboarding_v2', user_id: USER, arm: 'tour_hard', reason: 'bucket', first_exposed_at: NOW.toISOString(), assigned_at: NOW.toISOString() },
      { experiment_key: 'onboarding_v2', user_id: QA, arm: 'control', reason: 'override', assigned_at: NOW.toISOString() },
    ]);
    const { status, body } = await json(await LIST(req('/api/admin/experiments')));
    expect(status).toBe(200);
    const e = body.data.experiments[0];
    expect(e).not.toHaveProperty('salt');
    expect(e).toMatchObject({ key: 'onboarding_v2', status: 'draft', trafficPct: 20, fallbackArm: 'control' });
    expect(e.counts).toEqual({
      control: { assigned: 0, exposed: 0, overrides: 1, other: 0 },
      tour_hard: { assigned: 1, exposed: 1, overrides: 0, other: 0 },
      tour_soft: { assigned: 0, exposed: 0, overrides: 0, other: 0 },
    });
  });

  it('creates a draft with a random salt; validates weights and fallback; 409 on duplicates', async () => {
    const body = { key: 'paywall_copy', name: 'Paywall copy', arms: [{ key: 'a', weight: 50 }, { key: 'b', weight: 50 }], fallbackArm: 'a' };
    const created = await json(await CREATE(req('/api/admin/experiments', { method: 'POST', body })));
    expect(created.status).toBe(201);
    expect(created.body.data.experiment).toMatchObject({ key: 'paywall_copy', status: 'draft', trafficPct: 100, audience: {} });
    expect(db.getRows('experiments').find((r) => r.key === 'paywall_copy')!.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(audit()[0]).toMatchObject({ experiment_key: 'paywall_copy', action: 'create', actor: 'ani@inov8rlabs.com' });
    expect((await CREATE(req('/api/admin/experiments', { method: 'POST', body }))).status).toBe(409);
    const badWeights = await json(await CREATE(req('/api/admin/experiments', { method: 'POST', body: { ...body, key: 'x', arms: [{ key: 'a', weight: 60 }, { key: 'b', weight: 50 }] } })));
    expect(badWeights.status).toBe(400);
    expect(JSON.stringify(badWeights.body.error)).toContain('VALIDATION_ERROR');
    expect((await CREATE(req('/api/admin/experiments', { method: 'POST', body: { ...body, key: 'y', fallbackArm: 'zzz' } }))).status).toBe(400);
  });

  it('detail: experiment, counts, overrides, audit; 404 for unknown', async () => {
    const { body } = await json(await GET_ONE(req('/api/admin/experiments/onboarding_v2'), params('onboarding_v2')));
    expect(Object.keys(body.data).sort()).toEqual(['audit', 'counts', 'experiment', 'overrides']);
    expect((await GET_ONE(req('/api/admin/experiments/nope'), params('nope'))).status).toBe(404);
  });
});

describe('PATCH (lifecycle, weights, traffic)', () => {
  it('draft → running stamps startedAt and is audited as a status change', async () => {
    const { status, body } = await json(await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { status: 'running' } }), params('onboarding_v2')));
    expect(status).toBe(200);
    expect(body.data.experiment).toMatchObject({ status: 'running', startedAt: NOW.toISOString() });
    expect(audit()[0]).toMatchObject({ action: 'status', before: expect.objectContaining({ status: 'draft' }), after: expect.objectContaining({ status: 'running' }) });
    expect(audit()[0].after).not.toHaveProperty('salt');
  });

  it('collection PATCH takes the key in the body', async () => {
    const { body } = await json(await PATCH_COLLECTION(req('/api/admin/experiments', { method: 'PATCH', body: { key: 'onboarding_v2', trafficPct: 100 } })));
    expect(body.data.experiment.trafficPct).toBe(100);
  });

  it('weights change only the definition; existing assignments are untouched', async () => {
    db.seed('experiment_assignments', [{ experiment_key: 'onboarding_v2', user_id: USER, arm: 'tour_hard', reason: 'bucket', assigned_at: NOW.toISOString() }]);
    const arms = [{ key: 'control', weight: 10, payload: {} }, { key: 'tour_hard', weight: 45, payload: {} }, { key: 'tour_soft', weight: 45, payload: {} }];
    expect((await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { arms } }), params('onboarding_v2'))).status).toBe(200);
    expect(db.getRows('experiment_assignments')[0].arm).toBe('tour_hard');
    // Removing an arm with assignments is a 409.
    const res = await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { arms: [{ key: 'control', weight: 100, payload: {} }] } }), params('onboarding_v2'));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('ARM_IN_USE');
  });

  it('illegal transitions → 409; conclude needs a winner (400)', async () => {
    expect((await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { status: 'paused' } }), params('onboarding_v2'))).status).toBe(409);
    await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { status: 'running' } }), params('onboarding_v2'));
    const noWinner = await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { status: 'concluded' } }), params('onboarding_v2'));
    expect(noWinner.status).toBe(400);
    expect((await noWinner.json()).error.code).toBe('WINNER_REQUIRED');
    const done = await json(await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { status: 'concluded', winnerArm: 'tour_soft' } }), params('onboarding_v2')));
    expect(done.body.data.experiment).toMatchObject({ status: 'concluded', winnerArm: 'tour_soft', endedAt: NOW.toISOString() });
  });

  it('rejects unknown fields (salt is immutable)', async () => {
    expect((await PATCH_ONE(req('/api/admin/experiments/onboarding_v2', { method: 'PATCH', body: { salt: 'x' } }), params('onboarding_v2'))).status).toBe(400);
  });
});

describe('overrides', () => {
  it('set by email (case-insensitive) or userId, list with emails, remove (also drops the override assignment)', async () => {
    const set = await json(await POST_OVERRIDE(req('/api/admin/experiments/onboarding_v2/overrides', { method: 'POST', body: { email: 'qa@example.com', arm: 'tour_hard', note: 'QA' } }), params('onboarding_v2')));
    expect(set.status).toBe(200);
    expect(set.body.data.overrides).toEqual([expect.objectContaining({ userId: QA, email: 'QA@Example.com', arm: 'tour_hard', note: 'QA', createdBy: 'ani@inov8rlabs.com' })]);
    expect(audit().at(-1)).toMatchObject({ action: 'override_set' });

    const list = await json(await GET_OVERRIDES(req('/api/admin/experiments/onboarding_v2/overrides'), params('onboarding_v2')));
    expect(list.body.data.overrides).toHaveLength(1);

    db.seed('experiment_assignments', [{ experiment_key: 'onboarding_v2', user_id: QA, arm: 'tour_hard', reason: 'override', assigned_at: NOW.toISOString() }]);
    const removed = await json(await DELETE_OVERRIDE(req(`/api/admin/experiments/onboarding_v2/overrides?userId=${QA}`, { method: 'DELETE' }), params('onboarding_v2')));
    expect(removed.body.data.overrides).toEqual([]);
    expect(db.getRows('experiment_assignments')).toHaveLength(0);
    expect(audit().at(-1)).toMatchObject({ action: 'override_removed' });
  });

  it('unknown arm → 400; unknown user → 404; removing a missing override → 404', async () => {
    expect((await POST_OVERRIDE(req('/x', { method: 'POST', body: { email: 'qa@example.com', arm: 'ghost' } }), params('onboarding_v2'))).status).toBe(400);
    expect((await POST_OVERRIDE(req('/x', { method: 'POST', body: { email: 'nobody@example.com', arm: 'control' } }), params('onboarding_v2'))).status).toBe(404);
    expect((await DELETE_OVERRIDE(req('/x', { method: 'DELETE', body: { email: 'qa@example.com' } }), params('onboarding_v2'))).status).toBe(404);
  });
});

describe('release-gate', () => {
  it('clears every subscription_required gate, pauses a running experiment, audits; idempotent', async () => {
    db.getRows('experiments')[0].status = 'running';
    const first = await json(await RELEASE(req('/x', { method: 'POST' }), params('onboarding_v2')));
    expect(first.body.data).toEqual({ released: 1, status: 'paused' });
    expect(db.getRows('profiles').every((p) => p.onboarding_gate !== 'subscription_required')).toBe(true);
    expect(audit().at(-1)).toMatchObject({ action: 'release_gate', after: { status: 'paused', released: 1 } });
    const again = await json(await RELEASE(req('/x', { method: 'POST' }), params('onboarding_v2')));
    expect(again.body.data).toEqual({ released: 0, status: 'paused' });
  });
});

describe('results', () => {
  function seedUsers() {
    const t0 = new Date(NOW.getTime() - 40 * DAY).toISOString();
    const rows: Record<string, any>[] = [];
    const profiles: Record<string, any>[] = [];
    const events: Record<string, any>[] = [];
    for (let i = 0; i < 30; i++) {
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const arm = ARMS[i % 3].key;
      rows.push({ experiment_key: 'onboarding_v2', user_id: id, arm, reason: 'bucket', assigned_at: t0, first_exposed_at: t0, platform: i % 2 ? 'ios' : 'android', country: 'US' });
      const trial = arm === 'tour_hard' && i < 15;
      profiles.push({ id, trial_started_at: trial ? t0 : null, trial_ends_at: trial ? new Date(Date.parse(t0) + 3 * DAY).toISOString() : null, trial_converted_at: trial && i < 9 ? new Date(Date.parse(t0) + 3 * DAY).toISOString() : null });
      if (trial && i < 9) events.push({ id: `e${i}`, user_id: id, type: 'RENEWAL', environment: 'PRODUCTION', event_timestamp: new Date(Date.parse(t0) + 3 * DAY).toISOString(), raw: { price: 29.99, period_type: 'NORMAL' } });
    }
    // Excluded rows: unexposed, override, fallback, sandbox revenue.
    rows.push({ experiment_key: 'onboarding_v2', user_id: USER, arm: 'tour_hard', reason: 'bucket', assigned_at: t0, first_exposed_at: null });
    rows.push({ experiment_key: 'onboarding_v2', user_id: QA, arm: 'tour_hard', reason: 'override', assigned_at: t0, first_exposed_at: t0 });
    rows.push({ experiment_key: 'onboarding_v2', user_id: ADMIN, arm: 'control', reason: 'fallback', assigned_at: t0 });
    events.push({ id: 'sbx', user_id: rows[0].user_id, type: 'INITIAL_PURCHASE', environment: 'SANDBOX', event_timestamp: t0, raw: { price: 99 } });
    db.seed('experiment_assignments', rows);
    db.seed('profiles', profiles);
    db.seed('subscription_events', events);
  }

  it('per-arm metrics, exclusions, decision; cached 15 min; fresh=1 recomputes', async () => {
    seedUsers();
    const { status, body } = await json(await RESULTS(req('/api/admin/experiments/onboarding_v2/results'), params('onboarding_v2')));
    expect(status).toBe(200);
    const r = body.data;
    expect(r).toMatchObject({ experimentKey: 'onboarding_v2', arms: ['control', 'tour_hard', 'tour_soft'], control: 'control', cached: false, segment: null, segments: null });
    expect(r.excluded).toEqual({ unexposed: 1, overrides: 1, fallback: 1, winner: 0 });
    expect(r.population.exposed).toEqual({ control: 10, tour_hard: 10, tour_soft: 10 });
    const paid = r.metrics.find((m: any) => m.key === 'paid_conversion_d10');
    expect(paid.primary).toBe(true);
    expect(paid.arms.tour_hard).toMatchObject({ n: 10, x: 3 });
    expect(paid.arms.control).toMatchObject({ n: 10, x: 0 });
    const revenue = r.metrics.find((m: any) => m.key === 'revenue_per_user_d30');
    expect(revenue.arms.control.value).toBe(0); // sandbox purchase ignored
    expect(revenue.arms.tour_hard.value).toBeCloseTo(8.997, 2);
    expect(r.decision).toHaveProperty('candidate');

    const cached = await json(await RESULTS(req('/api/admin/experiments/onboarding_v2/results'), params('onboarding_v2')));
    expect(cached.body.data.cached).toBe(true);
    const fresh = await json(await RESULTS(req('/api/admin/experiments/onboarding_v2/results?fresh=1'), params('onboarding_v2')));
    expect(fresh.body.data.cached).toBe(false);
  });

  it('segment=platform splits; bad segment → 400', async () => {
    seedUsers();
    const { body } = await json(await RESULTS(req('/api/admin/experiments/onboarding_v2/results?segment=platform'), params('onboarding_v2')));
    expect(body.data.segment).toBe('platform');
    expect(body.data.segments.map((s: any) => s.value).sort()).toEqual(['android', 'ios']);
    expect(body.data.segments[0]).toHaveProperty('metrics');
    expect((await RESULTS(req('/api/admin/experiments/onboarding_v2/results?segment=age'), params('onboarding_v2'))).status).toBe(400);
  });
});

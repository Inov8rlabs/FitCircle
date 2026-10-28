/** /api/admin/experiment-layers/** + layered experiments through the admin and mobile APIs. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { experimentBucket } from '@/lib/experiments/bucket';
import { STICKY_LAYER_WARNING } from '@/lib/experiments/service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as ASSIGN } from '../../../mobile/experiments/assign/route';
import { GET as GET_EXPERIMENT, PATCH as PATCH_EXPERIMENT } from '../../experiments/[key]/route';
import { POST as CREATE_EXPERIMENT } from '../../experiments/route';
import { GET as GET_LAYER, PATCH as PATCH_LAYER } from '../[key]/route';
import { GET as LIST_LAYERS, POST as CREATE_LAYER } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return { ...authedUser };
  }),
}));

const SECRET = 'admin-secret';
const NOW = new Date('2026-11-10T12:00:00Z');
const secret = { authorization: `Bearer ${SECRET}`, 'x-admin-actor': 'ani@inov8rlabs.com' };
let db: FakeSupabase;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('ADMIN_API_SECRET', SECRET);
  db = new FakeSupabase({
    experiments: { uniqueKey: ['key'] },
    experiment_layers: { uniqueKey: ['key'] },
    experiment_assignments: { uniqueKey: ['experiment_key', 'user_id'] },
    experiment_overrides: { uniqueKey: ['experiment_key', 'user_id'] },
    experiment_audit_log: {},
    profiles: { uniqueKey: ['id'], rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'ani@inov8rlabs.com', is_admin: true }] },
    complimentary_grants: {},
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = secret) =>
  new NextRequest(`https://api.test${path}`, {
    method,
    headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const params = (key: string) => ({ params: Promise.resolve({ key }) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const ARMS = [
  { key: 'control', name: 'Control', weight: 50, payload: {} },
  { key: 'variantA', name: 'Variant A', weight: 50, payload: { copy: 'new' } },
];
const createLayer = () => CREATE_LAYER(req('/api/admin/experiment-layers', 'POST', { key: 'paywall', name: 'Paywall tests' }));
const createExp = (key: string, layer: unknown) =>
  CREATE_EXPERIMENT(req('/api/admin/experiments', 'POST', { key, name: key, arms: ARMS, layer }));

describe('layer admin API', () => {
  it('create / list / detail / patch; salt random, never returned, immutable', async () => {
    const created = await json(await createLayer());
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({
      layer: expect.objectContaining({ key: 'paywall', name: 'Paywall tests', description: null }),
      experiments: [],
      freeRanges: [{ start: 0, end: 10000 }],
    });
    expect(created.body.data.layer).not.toHaveProperty('salt');
    expect(db.getRows('experiment_layers')[0].salt).toMatch(/^[0-9a-f]{32}$/);
    expect((await createLayer()).status).toBe(409);

    const list = await json(await LIST_LAYERS(req('/api/admin/experiment-layers')));
    expect(list.body.data.layers).toHaveLength(1);

    const patched = await json(await PATCH_LAYER(req('/x', 'PATCH', { name: 'Paywall', description: 'copy + price' }), params('paywall')));
    expect(patched.body.data.layer).toMatchObject({ name: 'Paywall', description: 'copy + price' });
    expect((await PATCH_LAYER(req('/x', 'PATCH', { salt: 'x' }), params('paywall'))).status).toBe(400);
    expect((await GET_LAYER(req('/x'), params('nope'))).status).toBe(404);
    expect(db.getRows('experiment_audit_log').map((a) => [a.experiment_key, a.action])).toEqual([
      ['layer:paywall', 'layer_create'],
      ['layer:paywall', 'layer_update'],
    ]);
  });

  it('secret writes need X-Admin-Actor', async () => {
    const res = await CREATE_LAYER(req('/api/admin/experiment-layers', 'POST', { key: 'paywall', name: 'P' }, { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(400);
  });
});

describe('layered experiments (create / patch validation)', () => {
  it('slices, overlap 409, unknown layer 400, freeRanges, concluded releases its slice', async () => {
    await createLayer();
    expect((await createExp('copy', { key: 'paywall', start: 0, end: 5000 })).status).toBe(201);
    const overlap = await json(await createExp('price', { key: 'paywall', start: 4000, end: 6000 }));
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('LAYER_OVERLAP');
    expect(overlap.body.data.overlaps).toEqual([{ key: 'copy', status: 'draft', start: 0, end: 5000 }]);
    expect((await createExp('ghost', { key: 'nope', start: 0, end: 10 })).status).toBe(400);
    expect((await createExp('price', { key: 'paywall', start: 5000, end: 8000 })).status).toBe(201);

    const detail = await json(await GET_LAYER(req('/x'), params('paywall')));
    expect(detail.body.data.experiments.map((e: any) => [e.key, e.start, e.end, e.status, e.holdsSlice])).toEqual([
      ['copy', 0, 5000, 'draft', true],
      ['price', 5000, 8000, 'draft', true],
    ]);
    expect(detail.body.data.freeRanges).toEqual([{ start: 8000, end: 10000 }]);

    // Experiment GET returns the slice.
    expect((await json(await GET_EXPERIMENT(req('/x'), params('copy')))).body.data.experiment.layer).toEqual({ key: 'paywall', start: 0, end: 5000 });

    // Conclude `copy` → its slice is free for a new experiment.
    await PATCH_EXPERIMENT(req('/x', 'PATCH', { status: 'running' }), params('copy'));
    await PATCH_EXPERIMENT(req('/x', 'PATCH', { status: 'concluded', winnerArm: 'variantA' }), params('copy'));
    expect((await createExp('headline', { key: 'paywall', start: 0, end: 5000 })).status).toBe(201);
    expect((await json(await GET_LAYER(req('/x'), params('paywall')))).body.data.freeRanges).toEqual([{ start: 8000, end: 10000 }]);
  });

  it('moving a started experiment or its slice is allowed, audited, and warns that assignments are sticky', async () => {
    await createLayer();
    await createExp('copy', { key: 'paywall', start: 0, end: 5000 });
    await PATCH_EXPERIMENT(req('/x', 'PATCH', { status: 'running' }), params('copy'));
    const moved = await json(await PATCH_EXPERIMENT(req('/x', 'PATCH', { layer: { key: 'paywall', start: 0, end: 7000 } }), params('copy')));
    expect(moved.status).toBe(200);
    expect(moved.body.data.warnings).toEqual([STICKY_LAYER_WARNING]);
    expect(db.getRows('experiment_audit_log').at(-1)).toMatchObject({ action: 'layer', after: expect.objectContaining({ layer: { key: 'paywall', start: 0, end: 7000 } }) });
    const out = await json(await PATCH_EXPERIMENT(req('/x', 'PATCH', { layer: null }), params('copy')));
    expect(out.body.data.experiment.layer).toBeNull();
    // Drafts move without a warning.
    await createExp('draft_one', { key: 'paywall', start: 0, end: 100 });
    expect((await json(await PATCH_EXPERIMENT(req('/x', 'PATCH', { layer: { key: 'paywall', start: 100, end: 200 } }), params('draft_one')))).body.data.warnings).toEqual([]);
    // A slice edit into a sibling's slice is rejected.
    await createExp('other', { key: 'paywall', start: 9000, end: 10000 });
    expect((await PATCH_EXPERIMENT(req('/x', 'PATCH', { layer: { key: 'paywall', start: 8500, end: 9500 } }), params('draft_one'))).status).toBe(409);
  });
});

describe('mobile assign with layers', () => {
  const USER_BASE = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const profile = (id: string) => ({ id, created_at: NOW.toISOString(), onboarding_completed: false, subscription_tier: 'free' });
  const assign = async (keys: string[]) =>
    (await (await ASSIGN(new NextRequest('https://api.test/api/mobile/experiments/assign', {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'x-app-platform': 'ios', 'x-app-version': '1.2.0' },
      body: JSON.stringify({ keys }),
    }))).json()).data.assignments;

  async function twoRunning(leftEnd = 5000) {
    await createLayer();
    await createExp('copy', { key: 'paywall', start: 0, end: leftEnd });
    await createExp('price', { key: 'paywall', start: leftEnd, end: 10000 });
    for (const k of ['copy', 'price']) await PATCH_EXPERIMENT(req('/x', 'PATCH', { status: 'running' }), params(k));
  }

  it('each user is randomised into exactly one experiment of the layer (300 users, one call each)', async () => {
    await twoRunning();
    const salt = db.getRows('experiment_layers')[0].salt;
    for (let i = 0; i < 300; i++) {
      authedUser = profile(USER_BASE(i));
      const a = await assign(['copy', 'price']);
      expect([a.copy.enrolled, a.price.enrolled].filter(Boolean)).toHaveLength(1);
      expect([a.copy.reason, a.price.reason].sort()).toEqual(['bucket', 'layer']);
      expect(a.copy.enrolled).toBe(experimentBucket(USER_BASE(i), salt) < 5000);
    }
    const rows = db.getRows('experiment_assignments');
    expect(rows.filter((r) => r.reason === 'bucket')).toHaveLength(300);
    expect(rows.filter((r) => r.reason === 'layer')).toHaveLength(300);
  });

  it('layer_conflict after a slice edit (existing enrolment in a running sibling)', async () => {
    await twoRunning();
    const salt = db.getRows('experiment_layers')[0].salt;
    let u = 0;
    while (experimentBucket(USER_BASE(u), salt) >= 5000) u++;
    authedUser = profile(USER_BASE(u));
    expect((await assign(['copy'])).copy.enrolled).toBe(true);
    // Shrink `copy`, widen `price` over the user's bucket; the user's `copy` row stays (sticky).
    await PATCH_EXPERIMENT(req('/x', 'PATCH', { layer: { key: 'paywall', start: 0, end: 1 } }), params('copy'));
    await PATCH_EXPERIMENT(req('/x', 'PATCH', { layer: { key: 'paywall', start: 1, end: 10000 } }), params('price'));
    const second = await assign(['price']);
    expect(second.price).toMatchObject({ arm: 'control', enrolled: false, reason: 'layer_conflict', name: 'Control' });
    expect(db.getRows('experiment_assignments').find((r) => r.experiment_key === 'price')).toMatchObject({ reason: 'layer_conflict' });
  });

  it('an override bypasses the layer', async () => {
    await twoRunning();
    const salt = db.getRows('experiment_layers')[0].salt;
    let u = 0;
    while (experimentBucket(USER_BASE(u), salt) < 5000) u++; // outside `copy`
    db.seed('experiment_overrides', [{ experiment_key: 'copy', user_id: USER_BASE(u), arm: 'variantA' }]);
    authedUser = profile(USER_BASE(u));
    expect((await assign(['copy'])).copy).toMatchObject({ arm: 'variantA', enrolled: false });
  });
});

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getHomeFeedDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});
vi.mock('@/lib/services/campaign-service', () => ({ CampaignService: { listForViewer: async () => ({ campaigns: [], homeSlug: null }) } }));
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: { isProgramEnabled: async () => true } }));
vi.mock('@/lib/services/entitlement-service', () => ({
  EntitlementService: { areSubscriptionsEnabled: async () => true },
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({ VitalsService: { getHydrationToday: async () => ({ todayMl: 0, goalMl: 2000, date: '2026-10-22' }) } }));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { bucketOf } from '@/lib/home-feed/rules';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { GET as preview } from '../preview/route';
import { GET as list, PATCH as patch, POST as create } from '../rules/route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: HomeFeedFakeDb;

const req = (url: string, opts: { as?: string; auth?: string; method?: string; body?: unknown } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      ...(opts.auth ? { authorization: opts.auth } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

const WATER_FIRST = {
  key: 'water_first',
  priority: 100,
  description: '50/50: hydration card directly under the header vs default order.',
  platforms: ['ios', 'android'],
  minAppVersion: '1.0.8',
  experiment: {
    key: 'water_first',
    arms: [
      { name: 'treatment', percent: 50, actions: [{ op: 'move', card: 'hydration', after: 'header' }, { op: 'move', card: 'referral', after: 'hydration' }] },
      { name: 'control', percent: 50, actions: [] },
    ],
  },
};

beforeEach(() => {
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearRulesCache();
  db.rows('profiles').push(
    { id: ADMIN, is_admin: true, timezone: 'UTC', subscription_tier: 'free', created_at: '2026-01-01T00:00:00Z' },
    { id: USER, is_admin: false, timezone: 'America/New_York', subscription_tier: 'free', created_at: '2026-10-01T00:00:00Z' }
  );
  process.env.ADMIN_API_SECRET = 'shh';
});
afterEach(() => {
  delete process.env.ADMIN_API_SECRET;
});

describe('admin auth (same gate as /api/admin/campaigns)', () => {
  it('401 signed out, 403 non-admin, 200 admin + API secret', async () => {
    expect((await list(req('/api/admin/home-feed/rules'))).status).toBe(401);
    const forbidden = await list(req('/api/admin/home-feed/rules', { as: USER }));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN');
    expect((await list(req('/api/admin/home-feed/rules', { as: ADMIN }))).status).toBe(200);
    expect((await list(req('/api/admin/home-feed/rules', { auth: 'Bearer shh' }))).status).toBe(200);
    expect((await list(req('/api/admin/home-feed/rules', { auth: 'Bearer nope' }))).status).toBe(401);
    expect((await preview(req(`/api/admin/home-feed/preview?userId=${USER}`, { as: USER }))).status).toBe(403);
    expect((await create(req('/api/admin/home-feed/rules', { as: USER, method: 'POST', body: WATER_FIRST }))).status).toBe(403);
    expect((await patch(req('/api/admin/home-feed/rules', { as: USER, method: 'PATCH', body: { key: 'x', enabled: true } }))).status).toBe(403);
  });
});

describe('rules CRUD', () => {
  it('POST creates a disabled rule by default, records who; GET lists it as valid', async () => {
    const res = await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: WATER_FIRST }));
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created).toMatchObject({ key: 'water_first', enabled: false, priority: 100, updated_by: ADMIN, valid: true, issues: [] });
    expect(created.definition.experiment.key).toBe('water_first');
    expect(created.definition).not.toHaveProperty('key');

    const listed = (await (await list(req('/api/admin/home-feed/rules', { as: ADMIN }))).json()).data.rules;
    expect(listed.map((r: any) => [r.key, r.enabled, r.valid])).toEqual([['water_first', false, true]]);
  });

  it('POST validates (400 with issues) and rejects duplicate keys (409)', async () => {
    const bad = await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: { key: 'bad', actions: [{ op: 'move', card: 'hydration' }] } }));
    expect(bad.status).toBe(400);
    const body = await bad.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.data.issues[0].message).toMatch(/exactly one/);
    expect((await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: {} }))).status).toBe(400);

    expect((await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: WATER_FIRST }))).status).toBe(201);
    const dup = await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: WATER_FIRST }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe('RULE_EXISTS');
  });

  it('PATCH enables by key or id, replaces + re-validates the definition, 404 unknown', async () => {
    const created = (await (await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: WATER_FIRST }))).json()).data;

    const enabled = await patch(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'PATCH', body: { key: 'water_first', enabled: true } }));
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).data).toMatchObject({ enabled: true, priority: 100 });

    const byId = await patch(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'PATCH', body: { id: created.id, priority: 5, definition: { actions: [{ op: 'hide', card: 'charts' }] } } }));
    expect((await byId.json()).data).toMatchObject({ priority: 5, definition: { actions: [{ op: 'hide', card: 'charts' }] }, valid: true });

    const invalid = await patch(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'PATCH', body: { key: 'water_first', definition: { actions: [] } } }));
    expect(invalid.status).toBe(400);
    expect((await patch(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'PATCH', body: { key: 'water_first' } }))).status).toBe(400);
    expect((await patch(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'PATCH', body: { enabled: true } }))).status).toBe(400);
    expect((await patch(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'PATCH', body: { key: 'nope', enabled: true } }))).status).toBe(404);
  });

  it('GET flags rows whose stored definition no longer validates', async () => {
    db.rows('home_feed_rules').push({ id: db.nextId(), key: 'legacy', enabled: true, priority: 0, definition: { actions: [{ op: 'teleport' }] } });
    const [row] = (await (await list(req('/api/admin/home-feed/rules', { as: ADMIN }))).json()).data.rules;
    expect(row).toMatchObject({ key: 'legacy', valid: false });
    expect(row.issues.length).toBeGreaterThan(0);
  });
});

describe('preview', () => {
  it('400 without a uuid userId, 404 unknown user', async () => {
    expect((await preview(req('/api/admin/home-feed/preview', { as: ADMIN }))).status).toBe(400);
    expect((await preview(req('/api/admin/home-feed/preview?userId=abc', { as: ADMIN }))).status).toBe(400);
    expect((await preview(req('/api/admin/home-feed/preview?userId=cccccccc-cccc-4ccc-8ccc-cccccccccccc', { as: ADMIN }))).status).toBe(404);
  });

  it('returns feed + context + trace for the user, defaulting to the full catalog, without recording', async () => {
    const res = await preview(req(`/api/admin/home-feed/preview?userId=${USER}&platform=ios&version=1.0.8`, { as: ADMIN }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.feed).toMatchObject({ schema: 1, layout_key: 'default-v1' });
    expect(data.feed.cards.length).toBe(16); // full catalog minus the (absent) campaign
    expect(data.context).toMatchObject({ userId: USER, platform: 'ios', appVersion: '1.0.8', timezone: 'America/New_York' });
    expect(data.killSwitch).toEqual({ feedEnabled: true, rulesEnabled: true });
    expect(data.trace).toMatchObject({ ranker: 'rules', suppressed: ['campaign'] });
    expect(db.rows('home_feed_decisions')).toHaveLength(0);
  });

  it('includeDisabled=true previews a disabled experiment', async () => {
    await create(req('/api/admin/home-feed/rules', { as: ADMIN, method: 'POST', body: WATER_FIRST }));
    const treated = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).find((u) => bucketOf(u, 'water_first') < 50)!;
    db.rows('profiles').push({ id: treated, timezone: 'UTC', subscription_tier: 'free' });

    const off = (await (await preview(req(`/api/admin/home-feed/preview?userId=${treated}&platform=ios&version=1.0.8`, { as: ADMIN }))).json()).data;
    expect(off.feed.experiment).toBeNull();
    expect(off.rulesEvaluated).toEqual([]);

    const on = (await (await preview(req(`/api/admin/home-feed/preview?userId=${treated}&platform=ios&version=1.0.8&includeDisabled=true`, { as: ADMIN }))).json()).data;
    expect(on.feed.experiment).toEqual({ key: 'water_first', arm: 'treatment' });
    expect(on.rulesEvaluated).toEqual([{ key: 'water_first', enabled: false, priority: 100, applied: true }]);
    expect(on.feed.cards.slice(1, 3).map((c: any) => c.type)).toEqual(['header', 'hydration']);
  });

  it('honours the cards param (what a specific client build would get)', async () => {
    const { data } = await (await preview(req(`/api/admin/home-feed/preview?userId=${USER}&cards=header@1,charts@1`, { as: ADMIN }))).json();
    expect(data.feed.cards.map((c: any) => c.type)).toEqual(['header', 'charts']);
  });
});

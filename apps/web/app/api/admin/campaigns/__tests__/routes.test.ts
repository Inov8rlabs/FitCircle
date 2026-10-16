import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('@/lib/middleware/rate-limit', () => ({
  applyRateLimit: async () => null,
  createRateLimiter: () => ({}),
  getIdentifier: () => 'ip',
}));
// Bearer "user:<id>" → that profile; anything else → 401.
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
    const profile = id ? getReferralDb().profile(id) : null;
    if (!profile) throw new Error('Unauthorized');
    return { ...profile };
  },
}));

import { GET as unsubGet, POST as unsubPost } from '@/api/campaigns/unsubscribe/route';
import { POST as participation } from '@/api/mobile/campaigns/[slug]/participation/route';
import { GET as getCampaign } from '@/api/mobile/campaigns/[slug]/route';
import { GET as listCampaigns } from '@/api/mobile/campaigns/route';
import { GET as seasonal } from '@/api/mobile/seasonal/route';
import { campaignUnsubscribeToken } from '@/lib/campaigns/unsubscribe';
import { seasonsFor } from '@/lib/seasonal/seasons';
import { advent, holdTheLine } from '@/lib/services/__tests__/campaign-fixtures';
import { ReferralFakeDb, getReferralDb, setReferralDb } from '@/lib/services/__tests__/referral-fake-db';

import { GET as adminMe } from '../../me/route';
import { POST as syncAppStore } from '../[id]/app-store/sync/route';
import { PATCH as adminPatch } from '../[id]/route';
import { GET as adminList, POST as adminCreate } from '../route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: ReferralFakeDb;

const req = (url: string, opts: { as?: string; auth?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      ...(opts.auth ? { authorization: opts.auth } : {}),
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  db.addProfile({ id: ADMIN, display_name: 'Ani', is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-07' } } });
  db.addProfile({ id: USER, display_name: 'Ben', is_admin: false, preferences: { campaignPreview: { asOf: '2026-12-07' } } });
  db.rows('campaigns').push(holdTheLine(), advent());
  process.env.ADMIN_API_SECRET = 'shh';
});
afterEach(() => {
  delete process.env.ADMIN_API_SECRET;
  vi.useRealTimers();
});

describe('admin auth', () => {
  it('403 for non-admins, 401 signed out, 200 for admins and the API secret', async () => {
    expect((await adminList(req('/api/admin/campaigns', { as: USER }))).status).toBe(403);
    const forbidden = await (await adminList(req('/api/admin/campaigns', { as: USER }))).json();
    expect(forbidden.error.code).toBe('FORBIDDEN');
    expect((await adminList(req('/api/admin/campaigns'))).status).toBe(401);
    const ok = await adminList(req('/api/admin/campaigns', { as: ADMIN }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.campaigns.map((c: any) => c.slug).sort()).toEqual(['advent_2026', 'hold_the_line']);
    expect((await adminList(req('/api/admin/campaigns', { auth: 'Bearer shh' }))).status).toBe(200);
    expect((await adminList(req('/api/admin/campaigns', { auth: 'Bearer wrong' }))).status).toBe(401);
  });

  it('/api/admin/me reports the flag for any signed-in user', async () => {
    expect((await (await adminMe(req('/api/admin/me', { as: USER }))).json()).data.isAdmin).toBe(false);
    expect((await (await adminMe(req('/api/admin/me', { as: ADMIN }))).json()).data.isAdmin).toBe(true);
  });

  it('PATCH returns 409 VERSION_CONFLICT on a stale version; create validates', async () => {
    const id = db.rows('campaigns')[0].id;
    const okRes = await adminPatch(req(`/api/admin/campaigns/${id}`, { as: ADMIN, method: 'PATCH', body: { version: 1, tagline: 'New' } }), params({ id }));
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).data).toMatchObject({ tagline: 'New', version: 2 });
    const stale = await adminPatch(req(`/api/admin/campaigns/${id}`, { as: ADMIN, method: 'PATCH', body: { version: 1, tagline: 'Old' } }), params({ id }));
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.data.current.version).toBe(2);
    const bad = await adminCreate(req('/api/admin/campaigns', { as: ADMIN, method: 'POST', body: { slug: 'x' } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('App Store sync without ASC env → 409 APP_STORE_NOT_CONNECTED', async () => {
    const id = db.rows('campaigns')[0].id;
    const res = await syncAppStore(req(`/api/admin/campaigns/${id}/app-store/sync`, { as: ADMIN, method: 'POST' }), params({ id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('APP_STORE_NOT_CONNECTED');
  });
});

describe('mobile campaign routes', () => {
  it('lists, gets (404 when hidden) and toggles participation', async () => {
    const list = await (await listCampaigns(req('/api/mobile/campaigns', { as: ADMIN }))).json();
    expect(list.success).toBe(true);
    expect(list.data.homeSlug).toBe('advent_2026');
    expect(list.data.campaigns[0]).toMatchObject({ slug: 'advent_2026', phase: 'live', dayNumber: 7, today: '2026-12-07' });

    const missing = await getCampaign(req('/api/mobile/campaigns/nope', { as: ADMIN }), params({ slug: 'nope' }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe('NOT_FOUND');

    const joined = await participation(req('/api/mobile/campaigns/advent_2026/participation', { as: ADMIN, method: 'POST', body: { reminders: true } }), params({ slug: 'advent_2026' }));
    expect((await joined.json()).data.participant).toEqual({ joined: true, reminders: true });
  });

  it('non-admin asOf is ignored (client timezone decides)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T18:00:00Z'));
    const list = await (await listCampaigns(req('/api/mobile/campaigns', { as: USER, headers: { 'x-client-timezone': 'America/New_York' } }))).json();
    expect(list.data.campaigns.map((c: any) => [c.slug, c.phase])).toEqual([['hold_the_line', 'teaser']]);
  });
});

describe('GET /api/mobile/seasonal compatibility', () => {
  it('matches the legacy seasons.ts shape for the same day', async () => {
    const res = await (await seasonal(req('/api/mobile/seasonal', { as: ADMIN }))).json();
    expect(res.success).toBe(true);
    const legacy = seasonsFor('2026-12-07');
    expect(res.data.current).toEqual(legacy.current);
    expect(Object.keys(res.data)).toEqual(['current', 'upcoming']);
    expect(res.data.upcoming).toBeNull(); // only migrated campaigns are in this fake db
  });

  it('falls back to seasons.ts when the campaigns query fails', async () => {
    (db as any).client = () => ({ from: () => { throw new Error('db down'); } });
    const res = await (await seasonal(req('/api/mobile/seasonal', { as: USER, headers: { 'x-client-timezone': 'UTC' } }))).json().catch(() => null);
    // requireMobileAuth is mocked independently of the db client.
    expect(res?.success).toBe(true);
    expect(res.data).toHaveProperty('current');
    expect(res.data).toHaveProperty('upcoming');
  });
});

describe('campaign unsubscribe route', () => {
  it('GET is side-effect free and shows a confirm page; POST opts out', async () => {
    const t = campaignUnsubscribeToken(USER);
    const page = await unsubGet(req(`/api/campaigns/unsubscribe?t=${encodeURIComponent(t)}`));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('method="post"');
    expect(db.profile(USER)!.preferences.marketingEmails).toBeUndefined();
    expect((await unsubGet(req('/api/campaigns/unsubscribe?t=bad'))).status).toBe(400);
    const done = await unsubPost(req(`/api/campaigns/unsubscribe?t=${encodeURIComponent(t)}`, { method: 'POST' }));
    expect((await done.json()).data).toEqual({ unsubscribed: true });
    expect(db.profile(USER)!.preferences.marketingEmails).toBe(false);
  });
});

/**
 * GET /api/mobile/feature-flags/[name]: allow-listed flags only, same response
 * shape as the food-log flag route, fails closed.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../../__tests__/helpers/fake-supabase';
import { GET } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authed = true;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authed) throw new Error('Unauthorized');
    return { id: USER, subscription_tier: 'free' };
  }),
}));

const USER = '33333333-3333-4333-8333-333333333333';
const FLAG = 'ga4_conversions_without_att';
let db: FakeSupabase;

const call = (name: string) =>
  GET(new NextRequest(`https://api.test/api/mobile/feature-flags/${name}`, { headers: { authorization: 'Bearer t' } }), {
    params: Promise.resolve({ name }),
  });

const seedFlag = (row: Record<string, unknown>) =>
  db.seed('feature_flags', [{ name: FLAG, allowed_user_ids: [], allowed_tiers: [], rollout_percentage: 0, ...row }]);

beforeEach(() => {
  authed = true;
  db = new FakeSupabase({ feature_flags: { uniqueKey: ['name'] }, profiles: { rows: [{ id: USER, subscription_tier: 'free' }] } });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

describe('GET /api/mobile/feature-flags/[name]', () => {
  it('seeded off → disabled, no-store envelope', async () => {
    seedFlag({ is_enabled: false });
    const res = await call(FLAG);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, error: null, data: { enabled: false, reason: 'disabled', access_level: 'none' } });
  });

  it('missing row → disabled (fails closed)', async () => {
    const body = await (await call(FLAG)).json();
    expect(body.data.enabled).toBe(false);
  });

  it('is_enabled alone is not enough; 100% rollout turns it on', async () => {
    seedFlag({ is_enabled: true, rollout_percentage: 0 });
    expect((await (await call(FLAG)).json()).data.enabled).toBe(false);

    db = new FakeSupabase({ feature_flags: { uniqueKey: ['name'] }, profiles: { rows: [{ id: USER, subscription_tier: 'free' }] } });
    vi.mocked(createAdminSupabase).mockReturnValue(db as any);
    seedFlag({ is_enabled: true, rollout_percentage: 100 });
    expect((await (await call(FLAG)).json()).data.enabled).toBe(true);
  });

  it('flags outside the allow-list are a 404, not a table probe', async () => {
    db.seed('feature_flags', [{ name: 'food_logging', is_enabled: true, rollout_percentage: 100 }]);
    const res = await call('food_logging');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('FLAG_NOT_FOUND');
  });

  it('401 without a valid session', async () => {
    authed = false;
    const res = await call(FLAG);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });
});

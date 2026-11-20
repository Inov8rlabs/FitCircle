/** POST /api/mobile/food-log/{id}/share (1.1.5 `circles` body + the unchanged legacy body) and GET share-targets. */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const s = vi.hoisted(() => ({ user: { id: '11111111-1111-4111-8111-111111111111' } as any, calls: [] as any[], legacy: [] as any[], fail: null as any }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => {
    if (!s.user) throw new Error('Unauthorized');
    return s.user;
  },
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/food-log-service', () => ({
  FoodLogService: {
    shareEntry: async (...a: any[]) => {
      s.legacy.push(a);
      return { shares: [{ id: 'share-1' }], error: null };
    },
  },
}));
vi.mock('@/lib/services/meal-share-service', async () => {
  class MealShareError extends Error {
    constructor(public readonly code: string, m: string) {
      super(m);
    }
  }
  return {
    MealShareError,
    MealShareService: {
      shareToCircles: async (...a: any[]) => {
        s.calls.push(a);
        if (s.fail) throw s.fail === 'NOT_FOUND' || s.fail === 'UNSHAREABLE' ? new MealShareError(s.fail, 'x') : new Error('boom');
        return { entry_id: a[1], is_private: false, visibility: 'circle', shared_circle_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'], posted: 1, retracted: 0 };
      },
      getShareTargets: async () => ({ sharing_default: 'unset', circles: [] }),
    },
  };
});

import { GET as TARGETS } from '../../../share-targets/route';
import { POST } from '../route';

const ENTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const post = (body: unknown) =>
  POST(new NextRequest(`https://x/api/mobile/food-log/${ENTRY}/share`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: ENTRY }) });

beforeEach(() => {
  s.user = { id: '11111111-1111-4111-8111-111111111111' };
  s.calls = [];
  s.legacy = [];
  s.fail = null;
});

describe('POST /food-log/{id}/share', () => {
  it('circles body → 200 with the contract shape, no-store; remember defaults to true', async () => {
    const res = await post({ circles: [{ circle_id: A, share: true }] });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, error: null, data: { entry_id: ENTRY, is_private: false, visibility: 'circle', shared_circle_ids: [A], posted: 1, retracted: 0 } });
    expect(s.calls[0][2]).toEqual({ circles: [{ circle_id: A, share: true }], remember: true });
    expect(s.legacy).toEqual([]);
  });

  it('400 VALIDATION_ERROR on a bad body; 404 for someone else\'s entry; 400 UNSHAREABLE; 500 retry-safe', async () => {
    expect((await post({ circles: [{ circle_id: 'nope', share: true }] })).status).toBe(400);
    expect((await (await post({ circles: 'x' })).json()).error.code).toBe('VALIDATION_ERROR');
    s.fail = 'NOT_FOUND';
    expect((await post({ circles: [] })).status).toBe(404);
    s.fail = 'UNSHAREABLE';
    const u = await post({ circles: [] });
    expect(u.status).toBe(400);
    expect((await u.json()).error.code).toBe('UNSHAREABLE');
    s.fail = 'other';
    expect((await post({ circles: [] })).status).toBe(500);
  });

  it('401 when signed out', async () => {
    s.user = null;
    expect((await post({ circles: [] })).status).toBe(401);
  });

  it('the legacy {share_with, circle_id} body still takes the old path (201)', async () => {
    const res = await post({ share_with: 'circle', circle_id: A });
    expect(res.status).toBe(201);
    expect(s.legacy).toHaveLength(1);
    expect(s.calls).toEqual([]);
  });
});

describe('GET /food-log/share-targets', () => {
  it('200 envelope, private no-store; 401 signed out', async () => {
    const res = await TARGETS(new NextRequest('https://x/api/mobile/food-log/share-targets'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ success: true, error: null, meta: null, data: { sharing_default: 'unset', circles: [] } });
    s.user = null;
    expect((await TARGETS(new NextRequest('https://x/api/mobile/food-log/share-targets'))).status).toBe(401);
  });
});

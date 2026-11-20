/** GET /streaks/save-offer, GET /streaks/celebrations, POST /streaks/celebrations/ack (ENGAGEMENT_115_SPEC §5.3–5.4). */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ user: { id: 'u1' } as any, acks: [] as any[], tz: [] as any[], peeks: [] as any[] }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => {
    if (!h.user) throw new Error('Unauthorized');
    return h.user;
  },
}));
vi.mock('@/lib/services/streak-save-service', () => ({
  StreakSaveService: {
    getOffer: async (_u: string, o: any) => (h.tz.push(o.timezone), h.peeks.push(o.peek), { eligible: false, reason: 'nothing_to_save' }),
  },
}));
vi.mock('@/lib/services/streak-celebration-service', () => ({
  StreakCelebrationService: {
    getPending: async () => ({ milestone: 7, name: '1-Week Warrior', icon: 'flame', shields_granted: 1, reached_on: '2026-11-13' }),
    ack: async (...a: any[]) => void h.acks.push(a),
  },
}));

import { POST as ACK } from '../celebrations/ack/route';
import { GET as CELEBRATIONS } from '../celebrations/route';
import { GET as SAVE_OFFER } from '../save-offer/route';

const get = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://x${path}`, { headers });

beforeEach(() => {
  h.user = { id: 'u1' };
  h.acks = [];
  h.tz = [];
  h.peeks = [];
});

describe('1.1.5 streak routes', () => {
  it('save-offer: envelope, no-store, client timezone forwarded; 401', async () => {
    const res = await SAVE_OFFER(get('/api/mobile/streaks/save-offer', { 'x-client-timezone': 'Europe/Berlin' }));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ success: true, error: null, meta: null, data: { eligible: false, reason: 'nothing_to_save' } });
    expect(h.tz).toEqual(['Europe/Berlin']);
    await SAVE_OFFER(get('/api/mobile/streaks/save-offer?peek=1'));
    expect(h.peeks).toEqual([false, true]);
    h.user = null;
    expect((await SAVE_OFFER(get('/api/mobile/streaks/save-offer'))).status).toBe(401);
  });

  it('celebrations: { pending }', async () => {
    const body = await (await CELEBRATIONS(get('/api/mobile/streaks/celebrations'))).json();
    expect(body.data).toEqual({ pending: { milestone: 7, name: '1-Week Warrior', icon: 'flame', shields_granted: 1, reached_on: '2026-11-13' } });
  });

  it('ack: 204, idempotent; 400 without a milestone; 401', async () => {
    const post = (body: unknown) => ACK(new NextRequest('https://x/api/mobile/streaks/celebrations/ack', { method: 'POST', body: JSON.stringify(body) }));
    const res = await post({ milestone: 7 });
    expect(res.status).toBe(204);
    expect(h.acks).toEqual([['u1', 7]]);
    expect((await post({ milestone: 7 })).status).toBe(204);
    expect((await post({})).status).toBe(400);
    expect((await post({ milestone: 'x' })).status).toBe(400);
    h.user = null;
    expect((await post({ milestone: 7 })).status).toBe(401);
  });
});

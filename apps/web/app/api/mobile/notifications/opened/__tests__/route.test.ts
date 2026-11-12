/**
 * POST /api/mobile/notifications/opened (docs/PUSH_NOTIFICATIONS.md §7):
 * sets notification_log.opened_at on the caller's row, first open only.
 * In-memory Supabase; mobile auth is `Bearer user:<id>`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => h.db }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
    if (!id) throw new Error('Unauthorized');
    return { id };
  },
}));

import { FakeSupabase } from '../../../../../../__tests__/helpers/fake-supabase';
import { POST } from '../route';

const USER = '11111111-2222-4333-8444-555555555555';
const OTHER = '22222222-2222-4333-8444-555555555555';
const ROW = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_ROW = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
let db: FakeSupabase;

const post = (body: unknown, as: string | null = USER, raw = false) =>
  POST(
    new NextRequest('https://www.fitcircle.ai/api/mobile/notifications/opened', {
      method: 'POST',
      headers: { ...(as ? { authorization: `Bearer user:${as}` } : {}), 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  );
const row = (id: string) => { const r = db.getRows('notification_log').find((x: any) => x.id === id); if (!r) throw new Error(`no notification_log row ${id}`); return r; };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T12:30:00Z'));
  db = new FakeSupabase({ notification_log: {} });
  h.db = db;
  db.seed('notification_log', [
    { id: ROW, user_id: USER, notification_type: 'meal_reminder_lunch', suppressed: false, opened_at: null, data: { mealType: 'lunch' } },
    { id: OTHER_ROW, user_id: OTHER, notification_type: 'meal_reminder_lunch', suppressed: false, opened_at: null, data: {} },
  ]);
});

describe('POST /api/mobile/notifications/opened', () => {
  it('sets opened_at on the first open and returns 204 no-store with no body', async () => {
    const res = await post({ notification_id: ROW });
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
    expect(row(ROW).opened_at).toBe('2026-11-12T12:30:00.000Z');
    expect(row(ROW).data).toEqual({ mealType: 'lunch' });
  });

  it('records the tapped action in data.openedAction', async () => {
    expect((await post({ notification_id: ROW, action: 'log_meal' })).status).toBe(204);
    expect(row(ROW).data).toEqual({ mealType: 'lunch', openedAction: 'log_meal' });
  });

  it('is idempotent: a repeat keeps the first opened_at and still returns 204', async () => {
    await post({ notification_id: ROW, action: 'default' });
    vi.setSystemTime(new Date('2026-11-12T13:00:00Z'));
    const res = await post({ notification_id: ROW, action: 'snooze' });
    expect(res.status).toBe(204);
    expect(row(ROW).opened_at).toBe('2026-11-12T12:30:00.000Z');
    expect(row(ROW).data.openedAction).toBe('default');
  });

  it('accepts an uppercase UUID (iOS UUID().uuidString) and explicit null action', async () => {
    expect((await post({ notification_id: ROW.toUpperCase(), action: null })).status).toBe(204);
    expect(row(ROW).opened_at).not.toBeNull();
  });

  it("404s another user's row and leaves it untouched", async () => {
    const res = await post({ notification_id: OTHER_ROW });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
    expect(row(OTHER_ROW).opened_at).toBeNull();
  });

  it('404s an unknown id', async () => {
    expect((await post({ notification_id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee' })).status).toBe(404);
  });

  it.each([
    ['missing id', {}],
    ['non-uuid id', { notification_id: 'meal:lunch:2026-11-12' }],
    ['numeric id', { notification_id: 42 }],
    ['malformed action', { notification_id: ROW, action: 'has spaces and <tags>' }],
  ])('400s a %s', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('400s a non-JSON body', async () => {
    expect((await post('not json', USER, true)).status).toBe(400);
  });

  it('401s without auth', async () => {
    const res = await post({ notification_id: ROW }, null);
    expect(res.status).toBe(401);
    expect(row(ROW).opened_at).toBeNull();
  });
});

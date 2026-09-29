import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase } from '@/lib/services/__tests__/helpers/fake-supabase';

let fake = createFakeSupabase();
let cookieToken: string | undefined;
const getUser = vi.fn();
const authenticateWithToken = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'sb-access-token' && cookieToken ? { value: cookieToken } : undefined),
  }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => fake.client.from(t), auth: { getUser: (...a: unknown[]) => getUser(...a) } }),
}));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: { authenticateWithToken: (...a: unknown[]) => authenticateWithToken(...a) },
}));
vi.mock('@/lib/services/check-in-service', () => ({
  getCheckInWithDetails: async (id: string) => ({
    data: fake.rows('daily_tracking').find((r) => r.id === id) ?? null,
    error: null,
  }),
  canViewCheckIn: () => false,
  isUserInChallenge: async () => false,
  deleteCheckIn: async (id: string, userId: string) => {
    await fake.client.from('daily_tracking').delete().eq('id', id).eq('user_id', userId);
    return { success: true, error: null };
  },
}));

import { DELETE, GET, PATCH } from '../route';

const ID = '33333333-3333-4333-8333-333333333333';
const ROW = {
  id: ID,
  user_id: 'user-1',
  tracking_date: '2026-09-27',
  weight_kg: 80,
  steps: 9000,
  mood_score: 7,
  energy_level: 6,
  notes: 'ok',
  is_public: true,
};

const call = (
  handler: typeof PATCH,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  handler(
    new Request(`http://localhost/api/check-ins/${ID}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: ID }) }
  );

const bearer = { Authorization: 'Bearer mobile-token' };
const stored = () => fake.rows('daily_tracking')[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fake = createFakeSupabase({ daily_tracking: [ROW] });
  cookieToken = undefined;
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  authenticateWithToken.mockImplementation(async (token: string) =>
    token === 'mobile-token' ? { id: 'user-1', email: 'x' } : null
  );
});

describe('PATCH /api/check-ins/[id] — web app (cookie, snake_case) is unchanged', () => {
  beforeEach(() => {
    cookieToken = 'web-cookie';
  });

  it('updates with snake_case keys and never consults the Bearer path', async () => {
    const res = await call(PATCH, 'PATCH', { weight_kg: 79.5, mood_score: 8 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ weight_kg: 79.5, mood_score: 8, steps: 9000 });
    expect(authenticateWithToken).not.toHaveBeenCalled();
  });

  it('null clears a metric', async () => {
    await call(PATCH, 'PATCH', { weight_kg: null });
    expect(stored()).toMatchObject({ weight_kg: null, steps: 9000 });
  });

  it('still validates the weight range', async () => {
    const res = await call(PATCH, 'PATCH', { weight_kg: 500 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Weight must be between 30-300 kg' });
  });

  it('snake_case wins when both spellings are sent', async () => {
    await call(PATCH, 'PATCH', { weight_kg: 81, weightKg: 70 });
    expect(stored().weight_kg).toBe(81);
  });
});

describe('PATCH /api/check-ins/[id] — mobile (Bearer, camelCase)', () => {
  it('without any credentials it is still a 401', async () => {
    const res = await call(PATCH, 'PATCH', { weightKg: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(stored().weight_kg).toBe(80);
  });

  it('an invalid Bearer token is a 401', async () => {
    const res = await call(PATCH, 'PATCH', { weightKg: null }, { Authorization: 'Bearer forged' });
    expect(res.status).toBe(401);
    expect(stored().weight_kg).toBe(80);
  });

  it.each([
    ['weightKg', 'weight_kg'],
    ['steps', 'steps'],
    ['moodScore', 'mood_score'],
    ['energyLevel', 'energy_level'],
  ])('iOS clearTrackingAttribute: { "%s": null } clears %s', async (key, column) => {
    const res = await call(PATCH, 'PATCH', { [key]: null }, bearer);
    expect(res.status).toBe(200);
    const body = await res.json();
    // iOS decodes APIResponse<DailyTracking>: needs success + the row under data.
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(ID);
    expect(body.data[column]).toBeNull();
    const others = ['weight_kg', 'steps', 'mood_score', 'energy_level'].filter((c) => c !== column);
    for (const other of others) expect(stored()[other]).toEqual((ROW as any)[other]);
  });

  it('iOS updateDailyTracking: camelCase values update, absent keys stay', async () => {
    const res = await call(PATCH, 'PATCH', { weightKg: 78.2, moodScore: 9, notes: 'better' }, bearer);
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ weight_kg: 78.2, mood_score: 9, notes: 'better', steps: 9000, energy_level: 6 });
  });

  it('the camelCase weight is range-checked too', async () => {
    const res = await call(PATCH, 'PATCH', { weightKg: 5 }, bearer);
    expect(res.status).toBe(400);
  });

  it('a body that is not an object changes no metric (the first request iOS sends)', async () => {
    const res = await call(PATCH, 'PATCH', 'eyJ3ZWlnaHRLZyI6bnVsbH0=', bearer);
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ weight_kg: 80, steps: 9000, mood_score: 7, energy_level: 6 });
  });

  it("cannot touch another user's check-in", async () => {
    authenticateWithToken.mockResolvedValue({ id: 'user-2' });
    const res = await call(PATCH, 'PATCH', { weightKg: null }, bearer);
    expect(res.status).toBe(403);
    expect(stored().weight_kg).toBe(80);
  });
});

describe('GET / DELETE /api/check-ins/[id]', () => {
  it('GET keeps the web keys and adds the mobile envelope', async () => {
    cookieToken = 'web-cookie';
    const res = await call(GET as any, 'GET');
    const body = await res.json();
    expect(body.checkIn.id).toBe(ID);
    expect(body.canEdit).toBe(true);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(ID);
  });

  it('DELETE works with a Bearer token', async () => {
    const res = await call(DELETE as any, 'DELETE', undefined, bearer);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(fake.rows('daily_tracking')).toHaveLength(0);
  });

  it('DELETE without credentials is still a 401', async () => {
    const res = await call(DELETE as any, 'DELETE');
    expect(res.status).toBe(401);
    expect(fake.rows('daily_tracking')).toHaveLength(1);
  });
});

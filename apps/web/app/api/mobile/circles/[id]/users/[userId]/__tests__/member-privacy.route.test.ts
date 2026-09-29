import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

import {
  iosCheckInHistoryProblems,
  iosEnvelopeProblems,
  iosWeightProgressProblems,
} from '../../../../__tests__/ios-models';

const requireMobileAuth = vi.fn();
const getUserProgress = vi.fn();
const getUserHistory = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_request: unknown, response: unknown) => response,
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
// The real privacy switch (getSectionVisibility) runs against the fake database;
// only the two heavy readers are replaced.
vi.mock('@/lib/services/user-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/services/user-service')>();
  class TestUserService extends original.UserService {
    static getUserProgress = (...args: unknown[]) => getUserProgress(...args);
    static getUserHistory = (...args: unknown[]) => getUserHistory(...args);
  }
  return { ...original, UserService: TestUserService };
});

import { GET as getHistory } from '../history/route';
import { GET as getProgress } from '../progress/route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const call = (handler: typeof getProgress, kind: string, userId: string, query = '') =>
  handler(
    new Request(`http://localhost/api/mobile/circles/${CIRCLE}/users/${userId}/${kind}${query}`) as any,
    { params: Promise.resolve({ id: CIRCLE, userId }) }
  );

const PROGRESS = {
  starting_weight: 94,
  current_weight: 89,
  target_weight: 84,
  progress_percentage: 50,
  weight_lost: 5,
  weight_to_go: 5,
  last_updated: '2026-09-27T08:00:00+00:00',
};

const HISTORY = {
  entries: [
    { id: 'c1', date: '2026-09-27', weight: 89, weight_change: -0.5, is_public: true, note: 'ok' },
    { id: 'c2', date: '2026-09-26', weight: 89.5, weight_change: null, is_public: true, note: null },
  ],
  total_count: 2,
  has_more: false,
};

let db: CircleFakeDb;
const setPreferences = (preferences: Record<string, unknown> | null) => {
  db.tables.profiles = [{ id: OWNER, display_name: 'Owner', preferences }];
};

beforeEach(() => {
  vi.clearAllMocks();
  db = new CircleFakeDb();
  setCircleDb(db);
  setPreferences({});
  requireMobileAuth.mockResolvedValue({ id: VIEWER });
  getUserProgress.mockResolvedValue(PROGRESS);
  getUserHistory.mockResolvedValue(HISTORY);
});

describe('GET .../users/[userId]/progress', () => {
  it('visible weight: unchanged payload with can_view true', async () => {
    const res = await call(getProgress, 'progress', OWNER);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ ...PROGRESS, weight_unit: 'kg', can_view: true });
    expect(iosWeightProgressProblems(body.data)).toEqual([]);
  });

  it('private weight: 200 with can_view false and empty values (was 403)', async () => {
    getUserProgress.mockRejectedValue(new Error('Weight data is private'));
    const res = await call(getProgress, 'progress', OWNER);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toEqual({
      starting_weight: null,
      current_weight: null,
      target_weight: null,
      progress_percentage: 0,
      weight_lost: 0,
      weight_to_go: 0,
      last_updated: null,
      weight_unit: 'kg',
      can_view: false,
    });
  });

  it('the private payload decodes as the iOS WeightProgressResponse', async () => {
    getUserProgress.mockRejectedValue(new Error('Weight data is private'));
    const body = await (await call(getProgress, 'progress', OWNER)).json();

    expect(iosEnvelopeProblems(body)).toEqual([]);
    expect(iosWeightProgressProblems(body.data)).toEqual([]);
  });

  it('lowercases the uppercase uuid iOS sends, so an owner is recognised as the owner', async () => {
    requireMobileAuth.mockResolvedValue({ id: OWNER });
    await call(getProgress, 'progress', OWNER.toUpperCase());

    expect(getUserProgress).toHaveBeenCalledWith(OWNER, OWNER, CIRCLE);
  });

  it('other failures are still 500, and 401 is still 401', async () => {
    getUserProgress.mockRejectedValue(new Error('User not found'));
    expect((await call(getProgress, 'progress', OWNER)).status).toBe(500);

    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await call(getProgress, 'progress', OWNER)).status).toBe(401);
  });
});

describe('GET .../users/[userId]/history', () => {
  it('visible history: unchanged payload with can_view true', async () => {
    const res = await call(getHistory, 'history', OWNER, '?limit=10&offset=0');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ ...HISTORY, can_view: true });
    expect(body.meta).toMatchObject({ limit: 10, offset: 0 });
    expect(getUserHistory).toHaveBeenCalledWith(OWNER, VIEWER, { circleId: CIRCLE, limit: 10, offset: 0 });
    expect(iosCheckInHistoryProblems(body.data)).toEqual([]);
  });

  it('show_progress off: can_view false and no entries, without reading the history', async () => {
    setPreferences({ show_progress: false });
    const res = await call(getHistory, 'history', OWNER);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ entries: [], total_count: 0, has_more: false, can_view: false });
    expect(getUserHistory).not.toHaveBeenCalled();
    expect(iosEnvelopeProblems(body)).toEqual([]);
    expect(iosCheckInHistoryProblems(body.data)).toEqual([]);
  });

  it('hiding only the weight does not hide the history', async () => {
    setPreferences({ show_weight: false });
    const body = await (await call(getHistory, 'history', OWNER)).json();

    expect(body.data.can_view).toBe(true);
    expect(body.data.entries).toHaveLength(2);
  });

  it('the owner always sees their own history, also with an uppercase id in the path', async () => {
    setPreferences({ show_progress: false, show_weight: false });
    requireMobileAuth.mockResolvedValue({ id: OWNER });
    const body = await (await call(getHistory, 'history', OWNER.toUpperCase())).json();

    expect(body.data.can_view).toBe(true);
    expect(getUserHistory).toHaveBeenCalledWith(OWNER, OWNER, expect.anything());
  });

  it('a user who never set preferences is visible (defaults)', async () => {
    setPreferences(null);
    expect((await (await call(getHistory, 'history', OWNER)).json()).data.can_view).toBe(true);
  });

  it('an unknown user is still 500, and 401 is still 401', async () => {
    db.tables.profiles = [];
    expect((await call(getHistory, 'history', OWNER)).status).toBe(500);

    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await call(getHistory, 'history', OWNER)).status).toBe(401);
  });
});

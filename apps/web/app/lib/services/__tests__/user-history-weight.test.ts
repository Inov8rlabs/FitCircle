/**
 * UserService.getUserHistory (GET /api/mobile/users/[userId]/history, no circle):
 * every entry is a weight in kg, so it obeys "Show weight", skips rows the
 * member made private, and never lists a 0 / missing weight.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserService } from '../user-service';

import { CircleFakeDb, getCircleDb, setCircleDb } from './circle-fake-db';

// Hoisted above the imports by vitest.
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db: CircleFakeDb;

beforeEach(() => {
  db = new CircleFakeDb();
  setCircleDb(db);
  db.tables.profiles = [{ id: MEMBER, display_name: 'M', preferences: {}, timezone: 'UTC' }];
  db.tables.daily_tracking = [
    { id: 'w3', user_id: MEMBER, tracking_date: '2026-11-03', weight_kg: 89.4, steps: 1587, is_public: true, notes: null },
    { id: 's', user_id: MEMBER, tracking_date: '2026-11-02', weight_kg: null, steps: 10109, is_public: true, notes: null },
    { id: 'w1', user_id: MEMBER, tracking_date: '2026-11-01', weight_kg: 89, steps: null, is_public: true, notes: 'ok' },
    { id: 'p', user_id: MEMBER, tracking_date: '2026-10-31', weight_kg: 95, steps: null, is_public: false, notes: null },
    { id: 'z', user_id: MEMBER, tracking_date: '2026-10-30', weight_kg: 0, steps: null, is_public: true, notes: null },
  ];
});

const sortedDesc = () => {
  // The fake ignores order(); emulate the database's tracking_date DESC.
  db.tables.daily_tracking.sort((a, b) => (a.tracking_date < b.tracking_date ? 1 : -1));
};

describe('UserService.getUserHistory without a circle', () => {
  it('lists real public weigh-ins only, newest first, change = newer − older', async () => {
    sortedDesc();
    const history = await UserService.getUserHistory(MEMBER, VIEWER);
    expect(history.entries.map((e) => [e.id, e.weight, e.weight_change])).toEqual([
      ['w3', 89.4, 0.4],
      ['w1', 89, null],
    ]);
  });

  it('the member sees their private weigh-in too', async () => {
    sortedDesc();
    const history = await UserService.getUserHistory(MEMBER, MEMBER);
    expect(history.entries.map((e) => e.id)).toEqual(['w3', 'w1', 'p']);
  });

  it('"Show weight" off: nothing for others (it used to list every weigh-in)', async () => {
    db.tables.profiles[0].preferences = { show_weight: false };
    expect((await UserService.getUserHistory(MEMBER, VIEWER)).entries).toEqual([]);
    expect((await UserService.getUserHistory(MEMBER, MEMBER)).entries.length).toBeGreaterThan(0);
  });

  it('"Show progress" off: nothing for others', async () => {
    db.tables.profiles[0].preferences = { show_progress: false };
    expect((await UserService.getUserHistory(MEMBER, VIEWER)).entries).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  DEMO_ACCOUNT,
  DemoAccountService,
  shiftDatesInJson,
  shiftTimestamp,
  streakEndingOn,
} from '@/lib/services/demo-account-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../helpers/fake-supabase';

vi.mock('@/lib/supabase-admin');

const { userId: USER, circleId: CIRCLE, email: EMAIL } = DEMO_ACCOUNT;
const OTHER = 'someone-else';
let db: FakeSupabase;

/** The fake has no delete(); the service only deletes cached plate scores. */
function withDelete(fake: FakeSupabase) {
  const from = fake.from.bind(fake);
  fake.from = ((table: string) => {
    const query: any = from(table);
    query.delete = () => ({
      eq: (column: string, value: unknown) => {
        const rows = fake.getRows(table);
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i][column] === value) rows.splice(i, 1);
        return Promise.resolve({ data: null, error: null });
      },
    });
    return query;
  }) as typeof fake.from;
  return fake;
}

function seedHistory(newestDay: string) {
  const day = (offset: number) => {
    const d = new Date(`${newestDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - offset);
    return d.toISOString().split('T')[0];
  };
  db.seed('profiles', [{ id: USER, email: EMAIL, current_streak: 0, longest_streak: 0 }]);
  db.seed('streak_claims', [0, 1, 2].map(o => ({
    id: `claim-${o}`, user_id: USER, claim_date: day(o),
    claimed_at: `${day(o)}T14:47:00.000Z`, created_at: `${day(o)}T14:47:00.000Z`,
  })));
  db.seed('daily_tracking', [0, 1, 2].map(o => ({
    id: `track-${o}`, user_id: USER, tracking_date: day(o), created_at: `${day(o)}T14:20:00.000Z`, steps: 9000 + o,
  })));
  db.seed('food_log_entries', [
    { id: 'food-0', user_id: USER, entry_date: day(0), logged_at: `${day(0)}T14:47:00.000Z`, created_at: `${day(0)}T14:49:00.000Z`, title: 'Oats' },
    { id: 'food-1', user_id: USER, entry_date: day(1), logged_at: `${day(1)}T19:30:00.000Z`, created_at: `${day(1)}T19:32:00.000Z`, title: 'Salad' },
    { id: 'food-x', user_id: OTHER, entry_date: day(0), logged_at: `${day(0)}T12:00:00.000Z`, created_at: `${day(0)}T12:00:00.000Z`, title: 'Not the demo user' },
  ]);
  db.seed('exercise_logs', [
    { id: 'ex-1', user_id: USER, exercise_date: day(1), started_at: `${day(1)}T13:45:00.000Z`, created_at: `${day(1)}T14:30:00.000Z` },
  ]);
  db.seed('engagement_activities', [
    { id: 'act-0', user_id: USER, activity_date: day(0), activity_type: 'circle_checkin', reference_id: 'claim-0', created_at: `${day(0)}T14:47:00.000Z` },
  ]);
  db.seed('plate_scores', [
    { id: 'plate-0', user_id: USER, score_date: day(0), score: 0 },
    { id: 'plate-x', user_id: OTHER, score_date: day(0), score: 70 },
  ]);
  db.seed('streak_shields', [
    { id: 'shield-m', user_id: USER, shield_type: 'milestone_shield', available_count: 1,
      metadata: { paid_boundaries: [`7:${day(1)}`], celebrated_milestone_days: [day(2)], last_award_at: `${day(1)}T14:45:00.000Z` } },
  ]);
  db.seed('engagement_streaks', [{ user_id: USER, current_streak: 0, longest_streak: 8, paused: false }]);
  db.seed('fitcircles', [{ id: CIRCLE, end_date: `${day(0)}T00:00:00.000Z` }]);
  db.seed('circle_messages', [
    { id: 'msg-new', fitcircle_id: CIRCLE, created_at: `${day(1)}T01:30:00.000Z`, deleted_at: null },
    { id: 'msg-old', fitcircle_id: CIRCLE, created_at: `${day(2)}T20:00:00.000Z`, deleted_at: null },
    { id: 'msg-other', fitcircle_id: 'another-circle', created_at: `${day(2)}T20:00:00.000Z`, deleted_at: null },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 09:00 in Los Angeles on 29 Sep 2026.
  vi.setSystemTime(new Date('2026-09-29T16:00:00.000Z'));
  db = withDelete(
    new FakeSupabase({
      profiles: { uniqueKey: ['id'] },
      streak_claims: { uniqueKey: ['user_id', 'claim_date'] },
      daily_tracking: { uniqueKey: ['user_id', 'tracking_date'] },
      engagement_streaks: { uniqueKey: ['user_id'] },
    })
  );
  (createAdminSupabase as any).mockReturnValue(db);
});

afterEach(() => vi.useRealTimers());

describe('pure helpers', () => {
  it('moves timestamps by whole days', () => {
    expect(shiftTimestamp('2026-09-23T14:47:00.000Z', 6)).toBe('2026-09-29T14:47:00.000Z');
  });

  it('moves every date inside shield bookkeeping', () => {
    expect(
      shiftDatesInJson({ paid_boundaries: ['7:2026-09-17'], last_award_at: '2026-09-17T04:21:42.898Z', n: 1 }, 5)
    ).toEqual({ paid_boundaries: ['7:2026-09-22'], last_award_at: '2026-09-22T04:21:42.898Z', n: 1 });
  });

  it('counts the run of claimed days that ends today', () => {
    expect(streakEndingOn('2026-09-29', ['2026-09-29', '2026-09-28', '2026-09-26'])).toBe(2);
    expect(streakEndingOn('2026-09-29', ['2026-09-28'])).toBe(0);
  });
});

describe('DemoAccountService.refresh', () => {
  it('slides a stale history forward so the newest day is today', async () => {
    seedHistory('2026-09-23');

    const result = await DemoAccountService.refresh();

    expect(result).toMatchObject({ today: '2026-09-29', shiftedDays: 6, currentStreak: 3 });
    expect(db.getRows('streak_claims').map(r => r.claim_date).sort()).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    expect(db.getRows('daily_tracking').map(r => r.tracking_date).sort()).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);

    const food = db.getRows('food_log_entries');
    expect(food.find(r => r.id === 'food-0')).toMatchObject({ entry_date: '2026-09-29', logged_at: '2026-09-29T14:47:00.000Z' });
    expect(food.find(r => r.id === 'food-1')).toMatchObject({ entry_date: '2026-09-28' });
    expect(db.getRows('exercise_logs')[0]).toMatchObject({ exercise_date: '2026-09-28', started_at: '2026-09-28T13:45:00.000Z' });
    expect(db.getRows('engagement_activities')[0].activity_date).toBe('2026-09-29');
  });

  it('never puts an entry in the future', async () => {
    seedHistory('2026-09-23');
    await DemoAccountService.refresh();
    const now = Date.now();
    for (const row of db.getRows('food_log_entries').filter(r => r.user_id === USER)) {
      expect(new Date(row.logged_at).getTime()).toBeLessThanOrEqual(now);
    }
  });

  it('leaves other users and other circles alone', async () => {
    seedHistory('2026-09-23');
    await DemoAccountService.refresh();
    expect(db.getRows('food_log_entries').find(r => r.id === 'food-x')!.entry_date).toBe('2026-09-23');
    expect(db.getRows('plate_scores').map(r => r.id)).toEqual(['plate-x']);
    expect(db.getRows('circle_messages').find(r => r.id === 'msg-other')!.created_at).toBe('2026-09-21T20:00:00.000Z');
  });

  it('keeps the streak record, shield history, chat and circle in step', async () => {
    seedHistory('2026-09-23');

    const result = await DemoAccountService.refresh();

    expect(db.getRows('engagement_streaks')[0]).toMatchObject({
      current_streak: 3, longest_streak: 8, last_claim_date: '2026-09-29', last_engagement_date: '2026-09-29',
    });
    expect(db.getRows('profiles')[0]).toMatchObject({ current_streak: 3, longest_streak: 8 });
    expect(db.getRows('streak_shields')[0].metadata).toEqual({
      paid_boundaries: ['7:2026-09-28'], celebrated_milestone_days: ['2026-09-27'], last_award_at: '2026-09-28T14:45:00.000Z',
    });
    // Newest message was the evening of 21 Sep in Los Angeles; it becomes yesterday.
    expect(result.chatShiftedDays).toBe(7);
    expect(db.getRows('circle_messages').find(r => r.id === 'msg-new')!.created_at).toBe('2026-09-29T01:30:00.000Z');
    expect(db.getRows('fitcircles')[0].end_date).toBe('2026-10-29T00:00:00.000Z');
  });

  it('does nothing to the history when it already ends today', async () => {
    seedHistory('2026-09-29');
    const before = JSON.stringify(db.getRows('food_log_entries'));

    const result = await DemoAccountService.refresh();

    expect(result.shiftedDays).toBe(0);
    expect(result.rowsShifted).toEqual({});
    expect(JSON.stringify(db.getRows('food_log_entries'))).toBe(before);
    expect(db.getRows('plate_scores')).toHaveLength(2);
    expect(result.currentStreak).toBe(3);
  });

  it('refuses to run if the id no longer belongs to the demo account', async () => {
    seedHistory('2026-09-23');
    db.getRows('profiles')[0].email = 'a.real.person@example.com';

    const result = await DemoAccountService.refresh();

    expect(result.skipped).toBe('demo profile not found');
    expect(db.getRows('streak_claims').map(r => r.claim_date).sort()[2]).toBe('2026-09-23');
  });
});

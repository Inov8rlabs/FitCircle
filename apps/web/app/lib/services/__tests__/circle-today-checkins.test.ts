/**
 * 1.1.5 "Today: N of M checked in" (moved out of the chat thread):
 *  - CircleTodayCheckinsService: same definition as the daily summary (engagement_activities on
 *    the circle's local date), member list, reset at the next local midnight, fail-open.
 *  - DailySummaryService: remote config `circle_daily_summary_post` (default off) stops the chat
 *    post but keeps the bundled push; 'on' restores the post.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('../../supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
const send = vi.fn();
vi.mock('../notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return { ...real, NotificationOrchestrator: { ...real.NotificationOrchestrator, send: (...a: any[]) => send(...a) } };
});
vi.mock('../chat-notification-service', () => ({
  ChatNotificationService: {
    activeMembersOf: async () => [
      { userId: A, muted: false },
      { userId: B, muted: false },
      { userId: C, muted: false },
    ],
  },
}));
const ingest = vi.fn();
vi.mock('../system-post-engine', async (orig) => {
  const real: any = await orig();
  class FakeEngine extends real.SystemPostEngine {
    async ingest(signal: any, opts: any) {
      return ingest(signal, opts);
    }
  }
  return { ...real, SystemPostEngine: FakeEngine };
});

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { resetRemoteConfigCache } from '@/lib/remote-config/service';

import { CircleTodayCheckinsService } from '../circle-today-checkins-service';
import { DailySummaryService } from '../daily-summary-service';

const CIRCLE = '99999999-9999-4999-8999-999999999999';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let db: HomeFeedFakeDb;

beforeEach(() => {
  db = new HomeFeedFakeDb();
  Object.assign(db.tables, {
    fitcircles: [{ id: CIRCLE, name: 'Nov steps', creator_id: A, timezone: 'America/New_York', status: 'active' }],
    fitcircle_members: [
      { fitcircle_id: CIRCLE, user_id: A, status: 'active' },
      { fitcircle_id: CIRCLE, user_id: B, status: 'active' },
      { fitcircle_id: CIRCLE, user_id: C, status: 'active' },
      { fitcircle_id: CIRCLE, user_id: 'left-user', status: 'left' },
    ],
    profiles: [
      { id: A, display_name: 'Ani', avatar_url: null },
      { id: B, display_name: 'Bea', avatar_url: 'https://cdn.example.com/b.jpg' },
      { id: C, display_name: 'Cy', avatar_url: null },
    ],
    engagement_activities: [
      { user_id: B, activity_date: '2026-11-17' },
      { user_id: B, activity_date: '2026-11-17' },
      { user_id: C, activity_date: '2026-11-16' }, // yesterday: not today
      { user_id: 'left-user', activity_date: '2026-11-17' },
    ],
    circle_messages: [],
    notification_log: [],
    remote_config_rules: [],
    remote_config_defaults: [],
  });
  setHomeFeedDb(db);
  resetRemoteConfigCache();
  send.mockReset().mockResolvedValue({ sent: true });
  ingest.mockReset().mockResolvedValue({ written: [{ eventType: 'daily_summary', body: '1 of 3 checked in today' }] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('CircleTodayCheckinsService', () => {
  it("counts active members with activity on the circle's local date", async () => {
    // 23:30 New York on Nov 17 is already Nov 18 in UTC: the circle's day wins.
    const now = new Date('2026-11-18T04:30:00Z');
    const s = await CircleTodayCheckinsService.forCircle(CIRCLE, A, now);
    expect(s).toMatchObject({
      date: '2026-11-17',
      timezone: 'America/New_York',
      checkedIn: 1,
      total: 3,
      viewerCheckedIn: false,
      resetsAt: '2026-11-18T05:00:00.000Z',
    });
    // Checked in first, then by name; departed members are left out.
    expect(s!.members).toEqual([
      { id: B, name: 'Bea', avatarUrl: 'https://cdn.example.com/b.jpg', checkedIn: true },
      { id: A, name: 'Ani', avatarUrl: null, checkedIn: false },
      { id: C, name: 'Cy', avatarUrl: null, checkedIn: false },
    ]);
  });

  it('viewerCheckedIn reflects the viewer', async () => {
    const s = await CircleTodayCheckinsService.forCircle(CIRCLE, B, new Date('2026-11-17T15:00:00Z'));
    expect(s!.viewerCheckedIn).toBe(true);
  });

  it('resets at the next local midnight, including on DST days', () => {
    // Fall back (25 h day) and spring forward (23 h day) in New York.
    expect(CircleTodayCheckinsService.nextLocalMidnight('America/New_York', new Date('2026-11-01T04:10:00Z')).toISOString()).toBe(
      '2026-11-02T05:00:00.000Z'
    );
    expect(CircleTodayCheckinsService.nextLocalMidnight('America/New_York', new Date('2026-03-08T05:30:00Z')).toISOString()).toBe(
      '2026-03-09T04:00:00.000Z'
    );
  });

  it('fails open to null (never sinks the messages page)', async () => {
    db.tables.fitcircle_members = null as any;
    Object.defineProperty(db.tables, 'fitcircle_members', {
      get: () => {
        throw new Error('db down');
      },
    });
    expect(await CircleTodayCheckinsService.forCircle(CIRCLE, A, new Date('2026-11-17T15:00:00Z'))).toBeNull();
  });

  it('unknown circle → null', async () => {
    expect(await CircleTodayCheckinsService.forCircle('nope', A)).toBeNull();
  });
});

describe('DailySummaryService chat post switch (circle_daily_summary_post)', () => {
  const evening = new Date('2026-11-18T02:30:00Z'); // 21:30 New York, Nov 17

  it('default off: no chat post, the bundled push still goes out with the same copy', async () => {
    const result = await DailySummaryService.generateForAllActiveCircles(evening);

    expect(ingest).not.toHaveBeenCalled();
    expect(db.rows('circle_messages')).toHaveLength(0);
    expect(result.postsAttempted).toBe(0);
    expect(result.pushesPlanned).toBe(3);
    expect(send).toHaveBeenCalledWith(
      A,
      'circle_daily_summary',
      expect.objectContaining({ body: '1 of 3 checked in today', dedupeKey: 'daily_summary:2026-11-17', circleId: CIRCLE })
    );
  });

  it("'on' restores the chat post through the engine", async () => {
    db.rows('remote_config_defaults').push({ config_key: 'circle_daily_summary_post', value: 'on', updated_by: null, updated_at: '2026-11-17T00:00:00Z' });
    const result = await DailySummaryService.generateForAllActiveCircles(evening);

    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0]).toMatchObject({ eventType: 'daily_summary', payload: { checkedIn: 1, total: 3 } });
    expect(result.postsAttempted).toBe(1);
    expect(result.pushesPlanned).toBe(3);
  });

  it('off: still nothing before the local evening', async () => {
    const result = await DailySummaryService.generateForAllActiveCircles(new Date('2026-11-17T20:00:00Z')); // 15:00 NY
    expect(result.circlesProcessed).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

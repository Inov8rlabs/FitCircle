import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
const pushes = vi.hoisted(() => [] as Array<{ userId: string; type: string; data: any }>);
vi.mock('../notification-orchestrator', () => ({
  NotificationOrchestrator: {
    send: async (userId: string, type: string, data: any) => {
      pushes.push({ userId, type, data });
      return { sent: true };
    },
  },
}));
const chat = vi.hoisted(() => [] as Array<{ hook: string; args: unknown[] }>);
vi.mock('../chat-activity-hooks', () => ({
  ChatActivityHooks: {
    onCircleStreakMilestone: async (...args: unknown[]) => chat.push({ hook: 'milestone', args }),
    onCircleStreakSaved: async (...args: unknown[]) => chat.push({ hook: 'saved', args }),
    onCircleKickoff: async (...args: unknown[]) => chat.push({ hook: 'kickoff', args }),
  },
}));

import { localToday, addDays } from '../../streaks/streak-calculator';
import { seasonsFor } from '../../seasonal/seasons';
import { CircleLobbyService } from '../circle-lobby-service';
import { CircleStreakError, CircleStreakService } from '../circle-streak-service';

const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const [A, B, D, E, F] = ['a', 'b', 'd', 'e', 'f'].map((x) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`);
let db: ReferralFakeDb;
const flush = () => new Promise((r) => setTimeout(r, 25));
const today = localToday('UTC');
const yesterday = addDays(today, -1);

function claim(userId: string, date = today, method = 'manual_entry') {
  db.rows('streak_claims').push({ id: `${userId}-${date}-${Math.random()}`, user_id: userId, claim_date: date, claim_method: method });
}

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  pushes.length = 0;
  chat.length = 0;
  db.rows('fitcircles').push({
    id: C, name: 'Morning Movers', creator_id: A, timezone: 'UTC', invite_code: 'FITAB12CD',
    start_date: today, end_date: addDays(today, 30), status: 'active', metadata: null,
  });
  for (const [id, name] of [[A, 'Ana Ray'], [B, 'Ben'], [D, 'Dee'], [E, 'Eli'], [F, 'Fay']] as const) {
    db.addProfile({ id, display_name: name });
    db.rows('fitcircle_members').push({ fitcircle_id: C, user_id: id, status: 'active' });
  }
});

const streakRow = () => db.rows('circle_streaks').find((r) => r.fitcircle_id === C)!;

describe('circle streak', () => {
  it('extends on a majority day and never resets an in-progress today', async () => {
    db.rows('circle_streaks').push({ fitcircle_id: C, current_streak: 4, longest_streak: 9, last_active_date: yesterday, updated_at: '' });
    claim(A); // 1 of 5 — today still in progress
    await CircleStreakService.onMemberActivity(A, today);
    expect(streakRow()).toMatchObject({ current_streak: 4, last_active_date: yesterday });

    claim(B);
    claim(D, today, 'freeze'); // a shield freeze isn't showing up
    await CircleStreakService.recomputeForDay(C, today);
    expect(streakRow().current_streak).toBe(4);

    claim(E); // 3 of 5 = strict majority
    await CircleStreakService.recomputeForDay(C, today);
    expect(streakRow()).toMatchObject({ current_streak: 5, last_active_date: today, longest_streak: 9 });
  });

  it('a finished day without a majority ends the streak (cron settle)', async () => {
    db.rows('circle_streaks').push({ fitcircle_id: C, current_streak: 6, longest_streak: 6, last_active_date: addDays(today, -2), updated_at: '' });
    claim(A, yesterday);
    expect(await CircleStreakService.settleYesterday()).toEqual({ checked: 1, reset: 1 });
    expect(streakRow()).toMatchObject({ current_streak: 0, longest_streak: 6 });
  });

  it('celebrates milestones once: chat post + push to every member', async () => {
    db.rows('circle_streaks').push({ fitcircle_id: C, current_streak: 2, longest_streak: 2, last_active_date: yesterday, updated_at: '' });
    [A, B, D].forEach((u) => claim(u));
    await CircleStreakService.recomputeForDay(C, today);
    await CircleStreakService.recomputeForDay(C, today); // idempotent re-run
    await flush();
    await flush();
    expect(chat.filter((c) => c.hook === 'milestone')).toEqual([{ hook: 'milestone', args: [C, 3] }]);
    const milestonePushes = pushes.filter((p) => p.type === 'circle_streak_milestone');
    expect(milestonePushes.map((p) => p.userId).sort()).toEqual([A, B, D, E, F].sort());
    expect(milestonePushes[0].data).toMatchObject({ circleName: 'Morning Movers', streakDays: 3, circleId: C });
  });

  it("reports today's progress, the save pool and the next milestone", async () => {
    db.rows('circle_streaks').push({ fitcircle_id: C, current_streak: 4, longest_streak: 4, last_active_date: yesterday, updated_at: '' });
    claim(A);
    claim(B);
    const view = await CircleStreakService.getStreak(C, A);
    expect(view).toMatchObject({
      currentStreak: 4,
      today: { date: today, loggedCount: 2, activeCount: 5, needed: 3, qualified: false },
      saves: { poolRemaining: 5, poolSize: 5, mySaveAvailable: true },
      nextMilestone: { days: 7, remaining: 3 },
    });
    expect(view.today.members.slice(0, 2).map((m) => m.logged)).toEqual([true, true]);
    expect(view.today.members.find((m) => m.userId === D)).toMatchObject({ displayName: 'Dee', logged: false, covered: false });
  });

  it('shows a broken-but-unsettled streak as 0', async () => {
    db.rows('circle_streaks').push({ fitcircle_id: C, current_streak: 8, longest_streak: 8, last_active_date: addDays(today, -3), updated_at: '' });
    expect((await CircleStreakService.getStreak(C, A)).currentStreak).toBe(0);
  });

  it('save pool: one save per member per week, covers count, friend gets a push', async () => {
    db.rows('circle_streaks').push({ fitcircle_id: C, current_streak: 4, longest_streak: 4, last_active_date: yesterday, updated_at: '' });
    claim(A);
    claim(B);
    const out = await CircleStreakService.useSave(C, A, D);
    expect(out.created).toBe(true);
    expect(out.streak).toMatchObject({ currentStreak: 5, today: { loggedCount: 3, qualified: true }, saves: { poolRemaining: 4, mySaveAvailable: false } });
    expect(out.streak.today.members.find((m) => m.userId === D)).toMatchObject({ covered: true, coveredBy: 'Ana' });
    await flush();
    await flush();
    expect(chat.find((c) => c.hook === 'saved')?.args.slice(0, 3)).toEqual([C, A, D]);
    expect(pushes.find((p) => p.type === 'circle_streak_saved')).toMatchObject({ userId: D, data: { friendName: 'Ana', circleId: C } });

    // Replay for the same friend/day spends nothing; a second friend this week is refused.
    expect((await CircleStreakService.useSave(C, A, D)).created).toBe(false);
    await expect(CircleStreakService.useSave(C, A, E)).rejects.toMatchObject({ code: 'SAVE_USED', status: 409 });
  });

  it('refuses self, already-logged friends and out-of-range days', async () => {
    claim(B);
    await expect(CircleStreakService.useSave(C, A, A)).rejects.toBeInstanceOf(CircleStreakError);
    await expect(CircleStreakService.useSave(C, A, A)).rejects.toMatchObject({ code: 'SELF' });
    await expect(CircleStreakService.useSave(C, A, B)).rejects.toMatchObject({ code: 'NOT_NEEDED' });
    await expect(CircleStreakService.useSave(C, A, D, addDays(today, -2))).rejects.toMatchObject({ code: 'DATE_OUT_OF_RANGE' });
    expect((await CircleStreakService.useSave(C, A, D, yesterday)).created).toBe(true);
  });

  it('weeks start on Monday', () => {
    expect(CircleStreakService.weekStart('2026-10-15')).toBe('2026-10-12'); // Thu → Mon
    expect(CircleStreakService.weekStart('2026-10-18')).toBe('2026-10-12'); // Sun → Mon
    expect(CircleStreakService.weekStart('2026-10-19')).toBe('2026-10-19'); // Mon
  });
});

describe('lobby', () => {
  const LOBBY = '99999999-9999-4999-8999-999999999999';
  function seedLobby(members: string[], autoStartAt = new Date(Date.now() + 48 * 3600_000).toISOString()) {
    const plan = CircleLobbyService.plan(today, addDays(today, 30), 3);
    db.rows('fitcircles').push({
      id: LOBBY, name: 'Hold the Line Crew', creator_id: A, timezone: 'UTC', status: 'upcoming',
      start_date: plan.start_date, end_date: plan.end_date, metadata: { lobby: { ...plan.lobby, autoStartAt } },
    });
    for (const m of members) db.rows('fitcircle_members').push({ fitcircle_id: LOBBY, user_id: m, status: 'active' });
    return plan;
  }
  const lobbyCircle = () => db.rows('fitcircles').find((c) => c.id === LOBBY)!;

  it('plans a 72h auto-start that keeps the challenge length', () => {
    const now = new Date('2026-10-16T10:00:00Z');
    const plan = CircleLobbyService.plan('2026-10-16', '2026-11-15', 3, now);
    expect(plan).toMatchObject({ start_date: '2026-10-19', end_date: '2026-11-18', lobby: { minMembers: 3, durationDays: 30, startedAt: null } });
    expect(plan.lobby.autoStartAt).toBe('2026-10-19T10:00:00.000Z');
    expect(CircleLobbyService.view({ metadata: { lobby: plan.lobby } }, 2)).toMatchObject({ minMembers: 3, memberCount: 2, needed: 1 });
    expect(CircleLobbyService.view({ metadata: null }, 2)).toBeNull();
  });

  it('kicks off the moment the crew is full — once', async () => {
    seedLobby([A, B]);
    await CircleLobbyService.onMemberJoined(LOBBY);
    expect(lobbyCircle().metadata.lobby.startedAt).toBeNull();

    db.rows('fitcircle_members').push({ fitcircle_id: LOBBY, user_id: D, status: 'active' });
    await Promise.all([CircleLobbyService.onMemberJoined(LOBBY), CircleLobbyService.onMemberJoined(LOBBY)]);
    await flush();
    await flush();
    expect(lobbyCircle()).toMatchObject({ status: 'active', start_date: today, end_date: addDays(today, 30) });
    expect(lobbyCircle().metadata.lobby).toMatchObject({ startReason: 'full', startedAt: expect.any(String) });
    expect(chat.filter((c) => c.hook === 'kickoff')).toEqual([{ hook: 'kickoff', args: [LOBBY, 'Hold the Line Crew', 3, 'full'] }]);
    expect(pushes.filter((p) => p.type === 'circle_kickoff').map((p) => p.userId).sort()).toEqual([A, B, D].sort());
    expect(CircleLobbyService.view(lobbyCircle(), 3)).toMatchObject({ needed: 0, startedAt: expect.any(String) });
  });

  it('only the creator can start early', async () => {
    seedLobby([A, B]);
    expect(await CircleLobbyService.startNow(LOBBY, B)).toBe('forbidden');
    expect(await CircleLobbyService.startNow(LOBBY, A)).toBe('started');
    expect(await CircleLobbyService.startNow(LOBBY, A)).toBe('already_started');
    await flush();
    await flush();
    // The creator tapped it — no push to them, a push to the rest.
    expect(pushes.filter((p) => p.type === 'circle_kickoff').map((p) => p.userId)).toEqual([B]);
    expect(await CircleLobbyService.startNow(C, A)).toBe('not_lobby');
  });

  it('starts anyway when the 72h timer runs out', async () => {
    seedLobby([A], new Date(Date.now() - 60_000).toISOString());
    expect(await CircleLobbyService.autoStartDue()).toBe(1);
    expect(lobbyCircle().metadata.lobby.startReason).toBe('timer');
    expect(await CircleLobbyService.autoStartDue()).toBe(0);
  });
});

describe('seasons', () => {
  it('promotes Hold the Line from Oct 20, then Fresh Start from Dec 16', () => {
    expect(seasonsFor('2026-10-16')).toMatchObject({ current: null, upcoming: { key: 'hold_the_line' } });
    expect(seasonsFor('2026-10-20').current).toMatchObject({ key: 'hold_the_line', circle: { startDate: '2026-11-15', endDate: '2026-12-15' } });
    expect(seasonsFor('2026-12-15').current?.key).toBe('hold_the_line'); // last day; earlier season wins
    expect(seasonsFor('2026-12-20').current?.key).toBe('new_year_reset');
    expect(seasonsFor('2027-01-02').current?.key).toBe('new_year_reset');
    expect(seasonsFor('2027-03-20')).toEqual({ current: null, upcoming: null });
  });
});

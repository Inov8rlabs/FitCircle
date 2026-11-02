import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from './circle-fake-db';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
vi.mock('../supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));
vi.mock('../chat-activity-hooks', () => ({
  ChatActivityHooks: { onNewChallenge: async () => {}, onChallengeResolved: async () => {} },
}));

import { ChallengeStepsSyncService } from '../challenge-steps-sync-service';
import { ChallengeService } from '../circle-challenge-service';

const CIRCLE = '7d3f3a7d-1e1e-4ab1-85b5-bff9f619f0bf';
const CH = '2e75a6a9-3796-4bf7-b806-0df2fc090b1b';
const ANI = 'd15217cf-28ec-4d31-bd2c-908330e8993a';
const ABHA = '4850c193-f591-4169-9173-e26bd35242c7';
const TOR = 'America/Toronto';

let db: CircleFakeDb;
const participant = (user_id: string, extra: Record<string, unknown> = {}) => ({
  id: `p-${user_id.slice(0, 4)}`, challenge_id: CH, user_id, fitcircle_id: CIRCLE, status: 'active',
  cumulative_total: 0, today_total: 0, today_date: '2026-11-01', current_streak: 0, longest_streak: 0,
  last_logged_at: null, log_count: 0, rank: null, goal_completion_pct: 0, milestones_achieved: {},
  joined_at: '2026-11-01T20:04:04Z', ...extra,
});

beforeEach(() => {
  db = new CircleFakeDb();
  setCircleDb(db);
  db.tables.fitcircles = [{ id: CIRCLE, creator_id: ANI, type: 'weight_loss', start_date: '2026-11-02', end_date: '2026-11-30', timezone: 'America/New_York' }];
  db.tables.fitcircle_members = [ANI, ABHA].map((user_id) => ({ id: db.newId(), fitcircle_id: CIRCLE, user_id, status: 'active' }));
  db.tables.profiles = [
    { id: ANI, display_name: 'Ani', timezone: TOR },
    { id: ABHA, display_name: 'Abha', timezone: 'UTC' }, // never synced: falls back to the circle zone
  ];
  // The prod row as created: 3:02 PM start, unsnapped, still "scheduled".
  db.tables.challenges = [{
    id: CH, fitcircle_id: CIRCLE, creator_id: ANI, template_id: 'steps-8k-daily', name: '8,000 Steps Daily', category: 'cardio',
    goal_amount: 168000, unit: 'steps', status: 'scheduled', starts_at: '2026-11-02T20:02:00+00:00', ends_at: '2026-11-30T20:01:00+00:00',
    participant_count: 2, is_open: true,
  }];
  db.tables.challenge_participants = [participant(ANI), participant(ABHA)];
  db.tables.daily_tracking = [
    { user_id: ANI, tracking_date: '2026-11-01', steps: 15000, steps_synced_at: '2026-11-02T03:00:00Z' },
    { user_id: ANI, tracking_date: '2026-11-02', steps: 9200, steps_synced_at: '2026-11-02T19:00:00Z' },
    { user_id: ABHA, tracking_date: '2026-11-02', steps: 3100, steps_synced_at: '2026-11-02T18:00:00Z' },
  ];
  db.tables.challenge_logs = [
    { id: 'l1', challenge_id: CH, participant_id: participant(ABHA).id, user_id: ABHA, amount: 5000, log_date: '2026-11-02', logged_at: '2026-11-02T17:00:00Z' },
  ];
});
afterEach(() => vi.useRealTimers());

describe('ChallengeStepsSyncService', () => {
  // 2:00 PM Toronto on Nov 2 — before the stored 3:02 PM start.
  const NOW = new Date('2026-11-02T19:00:00Z');

  it('feeds synced steps into the participant fields on the local day', async () => {
    await ChallengeStepsSyncService.syncChallenge({ ...db.tables.challenges[0] }, NOW);
    const [ani, abha] = db.tables.challenge_participants;
    expect(ani).toMatchObject({ cumulative_total: 9200, today_total: 9200, today_date: '2026-11-02', goal_completion_pct: 5.48, current_streak: 1, log_count: 1, rank: 1 });
    expect(abha).toMatchObject({ cumulative_total: 5000, today_total: 5000, rank: 2 }); // manual log beats 3,100 synced
    expect(db.tables.challenges[0].status).toBe('scheduled'); // 3:02 PM start not reached yet
  });

  it('activates a scheduled challenge once its start passed', async () => {
    await ChallengeStepsSyncService.syncChallenge({ ...db.tables.challenges[0] }, new Date('2026-11-02T21:00:00Z'));
    expect(db.tables.challenges[0].status).toBe('active');
  });

  it('writes nothing when nothing changed', async () => {
    await ChallengeStepsSyncService.syncChallenge({ ...db.tables.challenges[0] }, NOW);
    const writes = db.log.filter((l) => l.op === 'update').length;
    await ChallengeStepsSyncService.syncChallenge({ ...db.tables.challenges[0] }, NOW);
    expect(db.log.filter((l) => l.op === 'update').length).toBe(writes);
  });

  it('leaves non-steps challenges alone', async () => {
    db.tables.challenges[0].unit = 'reps';
    const out = await ChallengeStepsSyncService.syncChallenge({ ...db.tables.challenges[0] }, NOW);
    expect(out.size).toBe(0);
    expect(db.tables.challenge_participants[0].cumulative_total).toBe(0);
  });

  it('syncUser refreshes the writer’s live steps challenges', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    await ChallengeStepsSyncService.syncUser(ANI);
    expect(db.tables.challenge_participants[0].cumulative_total).toBe(9200);
  });
});

describe('ChallengeService reads (shipped apps)', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-03T01:30:00Z'), toFake: ['Date'] })); // 8:30 PM Nov 2 Toronto

  it('the challenge list shows synced progress without a UTC reset', async () => {
    const list = await ChallengeService.getCircleChallenges(CIRCLE, ANI);
    const ch = [...list.active, ...list.scheduled][0];
    expect(ch.my_participation).toMatchObject({ cumulative_total: 9200, today_total: 9200, today_date: '2026-11-02' });
  });

  it('the challenge leaderboard ranks by synced steps', async () => {
    const board = await ChallengeService.getLeaderboard(CH, ANI);
    const byUser = Object.fromEntries(board.map((e) => [e.user_id, e]));
    expect(byUser[ANI]).toMatchObject({ cumulative_total: 9200, today_total: 9200 });
    expect(byUser[ABHA]).toMatchObject({ cumulative_total: 5000, today_total: 5000 });
  });
});

describe('createChallenge', () => {
  it('snaps starts_at/ends_at to local midnights', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T20:04:00Z'), toFake: ['Date'] });
    const created = await ChallengeService.createChallenge(
      ANI,
      {
        fitcircle_id: CIRCLE, template_id: 'steps-8k-daily', name: '8,000 Steps Daily', category: 'cardio', goal_amount: 168000,
        unit: 'steps', starts_at: '2026-11-02T20:02:00Z', ends_at: '2026-11-30T20:01:00Z',
      } as any,
      TOR
    );
    expect(created).toMatchObject({ starts_at: '2026-11-02T05:00:00.000Z', ends_at: '2026-11-30T05:00:00.000Z', status: 'scheduled' });
  });

  it("falls back to the creator's profile zone", async () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T20:04:00Z'), toFake: ['Date'] });
    const created = await ChallengeService.createChallenge(ANI, {
      fitcircle_id: CIRCLE, name: 'Walk', category: 'cardio', goal_amount: 1000, unit: 'steps',
      starts_at: '2026-11-01T20:04:00Z', ends_at: '2026-11-08T20:04:00Z',
    } as any);
    expect(created).toMatchObject({ starts_at: '2026-11-01T04:00:00.000Z', ends_at: '2026-11-08T05:00:00.000Z', status: 'active' });
  });
});

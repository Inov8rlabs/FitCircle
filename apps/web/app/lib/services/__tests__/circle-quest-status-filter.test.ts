import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from './circle-fake-db';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { CircleQuestService } from '../circle-quest-service';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const OTHER_CIRCLE = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const quest = (id: string, status: string, fitcircle_id = CIRCLE) => ({
  id,
  fitcircle_id,
  quest_name: `Quest ${id}`,
  quest_type: 'individual',
  goal_amount: 10,
  unit: 'reps',
  collective_progress: 0,
  starts_at: '2026-09-01T00:00:00+00:00',
  ends_at: '2026-12-01T00:00:00+00:00',
  status,
  created_by: USER,
  created_at: '2026-09-01T00:00:00+00:00',
});

beforeEach(() => {
  const db = new CircleFakeDb();
  db.tables.fitcircle_members.push({ id: 'm1', fitcircle_id: CIRCLE, user_id: USER, status: 'active' });
  db.tables.circle_quests.push(
    quest('q-active', 'active'),
    quest('q-pending', 'pending'),
    quest('q-completed', 'completed'),
    quest('q-expired', 'expired'),
    quest('q-elsewhere', 'completed', OTHER_CIRCLE)
  );
  db.tables.circle_quest_progress.push({
    id: 'p1',
    quest_id: 'q-completed',
    user_id: USER,
    individual_progress: 10,
    is_completed: true,
  });
  setCircleDb(db);
});

const ids = (quests: Array<{ id: string }>) => quests.map((q) => q.id).sort();

describe('CircleQuestService quest list by status', () => {
  it('getActiveQuests still returns active + pending only', async () => {
    expect(ids(await CircleQuestService.getActiveQuests(CIRCLE, USER))).toEqual(['q-active', 'q-pending']);
  });

  it('getQuests without statuses behaves like getActiveQuests', async () => {
    expect(ids(await CircleQuestService.getQuests(CIRCLE, USER))).toEqual(['q-active', 'q-pending']);
    expect(ids(await CircleQuestService.getQuests(CIRCLE, USER, []))).toEqual(['q-active', 'q-pending']);
  });

  it('returns completed and expired quests of THIS circle when asked, with the same fields', async () => {
    const quests = await CircleQuestService.getQuests(CIRCLE, USER, ['completed', 'expired']);

    expect(ids(quests)).toEqual(['q-completed', 'q-expired']);
    const completed = quests.find((q) => q.id === 'q-completed')!;
    expect(completed).toMatchObject({
      fitcircle_id: CIRCLE,
      status: 'completed',
      my_progress: 10,
      my_completed: true,
      participant_count: 1,
      completion_pct: 100,
    });
  });

  it('returns every status for `all`', async () => {
    const quests = await CircleQuestService.getQuests(CIRCLE, USER, ['pending', 'active', 'completed', 'expired']);
    expect(ids(quests)).toEqual(['q-active', 'q-completed', 'q-expired', 'q-pending']);
  });

  it('still refuses someone who is not a member, whatever the filter', async () => {
    await expect(CircleQuestService.getQuests(OTHER_CIRCLE, USER, ['completed'])).rejects.toThrow(
      'You must be an active member of this circle'
    );
  });
});

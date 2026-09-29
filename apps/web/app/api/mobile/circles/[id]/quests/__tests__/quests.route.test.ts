import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
const getQuests = vi.fn();
const createQuest = vi.fn();
const updateProgress = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/circle-quest-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/services/circle-quest-service')>();
  return {
    ...original,
    CircleQuestService: {
      getQuests: (...args: unknown[]) => getQuests(...args),
      getActiveQuests: (...args: unknown[]) => getQuests(...args, ['active', 'pending']),
      createQuest: (...args: unknown[]) => createQuest(...args),
      updateProgress: (...args: unknown[]) => updateProgress(...args),
    },
  };
});

import { resolveQuestStatuses } from '@/lib/services/circle-quest-service';

import { POST as postProgress } from '../[questId]/progress/route';
import { GET, POST } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const QUEST = '33333333-3333-4333-8333-333333333333';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const list = (query = '') =>
  GET(new Request(`http://localhost/api/mobile/circles/${CIRCLE}/quests${query}`) as any, {
    params: Promise.resolve({ id: CIRCLE }),
  });

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const QUEST_BODY = {
  quest_name: 'Team 10K',
  quest_type: 'collaborative',
  goal_amount: 10000,
  unit: 'steps',
  starts_at: '2026-10-01T00:00:00Z',
  ends_at: '2026-10-08T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: USER });
  getQuests.mockResolvedValue([{ id: QUEST, status: 'active' }]);
  createQuest.mockResolvedValue({ id: QUEST });
  updateProgress.mockResolvedValue({ individual_progress: 5, is_completed: false });
});

describe('resolveQuestStatuses', () => {
  it('defaults to active + pending, the list this route always returned', () => {
    expect(resolveQuestStatuses(null)).toEqual(['active', 'pending']);
    expect(resolveQuestStatuses(undefined)).toEqual(['active', 'pending']);
    expect(resolveQuestStatuses('')).toEqual(['active', 'pending']);
  });

  it('reads single values, aliases, lists and `all`', () => {
    expect(resolveQuestStatuses('completed')).toEqual(['completed']);
    expect(resolveQuestStatuses('expired')).toEqual(['expired']);
    expect(resolveQuestStatuses('active')).toEqual(['active']);
    expect(resolveQuestStatuses('upcoming')).toEqual(['pending']);
    expect(resolveQuestStatuses('ended')).toEqual(['completed', 'expired']);
    expect(resolveQuestStatuses('Completed, EXPIRED')).toEqual(['completed', 'expired']);
    expect(resolveQuestStatuses('all')).toEqual(['pending', 'active', 'completed', 'expired']);
  });

  it('skips unknown values and falls back to the default when nothing is left', () => {
    expect(resolveQuestStatuses('completed,bogus')).toEqual(['completed']);
    expect(resolveQuestStatuses('bogus')).toEqual(['active', 'pending']);
    expect(resolveQuestStatuses(',,')).toEqual(['active', 'pending']);
  });
});

describe('GET /api/mobile/circles/[id]/quests', () => {
  it('without `status`: active + pending, same envelope as before', async () => {
    const res = await list();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: [{ id: QUEST, status: 'active' }], error: null });
    expect(getQuests).toHaveBeenCalledWith(CIRCLE, USER, ['active', 'pending']);
  });

  it('passes the requested statuses to the service', async () => {
    await list('?status=completed');
    expect(getQuests).toHaveBeenLastCalledWith(CIRCLE, USER, ['completed']);

    await list('?status=completed,expired');
    expect(getQuests).toHaveBeenLastCalledWith(CIRCLE, USER, ['completed', 'expired']);

    await list('?status=all');
    expect(getQuests).toHaveBeenLastCalledWith(CIRCLE, USER, ['pending', 'active', 'completed', 'expired']);
  });

  it('an unknown status is not an error', async () => {
    const res = await list('?status=whatever');

    expect(res.status).toBe(200);
    expect(getQuests).toHaveBeenLastCalledWith(CIRCLE, USER, ['active', 'pending']);
  });

  it('403 for a non-member and 401 when unauthenticated, as before', async () => {
    getQuests.mockRejectedValue(new Error('You must be an active member of this circle'));
    expect((await list('?status=all')).status).toBe(403);

    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await list()).status).toBe(401);
  });
});

describe('POST /api/mobile/circles/[id]/quests', () => {
  const create = (body: unknown) =>
    POST(new Request(`http://localhost/api/mobile/circles/${CIRCLE}/quests`, json(body)) as any, {
      params: Promise.resolve({ id: CIRCLE }),
    });

  it('OLD SHAPE still creates a quest', async () => {
    const res = await create(QUEST_BODY);

    expect(res.status).toBe(200);
    expect(createQuest).toHaveBeenCalledWith(CIRCLE, USER, QUEST_BODY);
  });

  it('explicit nulls on optional fields are treated as not sent', async () => {
    const res = await create({
      ...QUEST_BODY,
      quest_description: null,
      collective_target: null,
      template_id: null,
      challenge_id: null,
      metadata: null,
    });

    expect(res.status).toBe(200);
    expect(createQuest).toHaveBeenCalledWith(CIRCLE, USER, QUEST_BODY);
  });

  it('400 VALIDATION_ERROR keeps code + details and gains a readable message', async () => {
    const res = await create({ ...QUEST_BODY, quest_name: 'ab' });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toMatch(/^quest_name: /);
    expect(createQuest).not.toHaveBeenCalled();
  });

  it('a null in a REQUIRED field is still rejected', async () => {
    expect((await create({ ...QUEST_BODY, goal_amount: null })).status).toBe(400);
  });
});

describe('POST /api/mobile/circles/[id]/quests/[questId]/progress', () => {
  const progress = (body: unknown) =>
    postProgress(
      new Request(`http://localhost/api/mobile/circles/${CIRCLE}/quests/${QUEST}/progress`, json(body)) as any,
      { params: Promise.resolve({ id: CIRCLE, questId: QUEST }) }
    );

  it('OLD SHAPE still logs progress', async () => {
    const res = await progress({ amount: 5 });

    expect(res.status).toBe(200);
    expect(updateProgress).toHaveBeenCalledWith(QUEST, USER, 5);
  });

  it('400 VALIDATION_ERROR with a readable message', async () => {
    const res = await progress({ amount: 0 });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('amount: Amount must be greater than 0');
    expect(Array.isArray(body.error.details)).toBe(true);
  });
});

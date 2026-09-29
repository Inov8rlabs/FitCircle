import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
const submitCheckIn = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({
  addAutoRefreshHeaders: async (_request: unknown, response: unknown) => response,
}));
vi.mock('@/lib/services/circle-service', () => ({
  CircleService: { submitCheckIn: (...args: unknown[]) => submitCheckIn(...args) },
}));
vi.mock('@/lib/services/boost-service', () => ({
  BoostService: { recalculateBoost: vi.fn().mockResolvedValue(undefined) },
}));

import { POST } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const post = (body: unknown) =>
  POST(
    new Request(`http://localhost/api/mobile/circles/${CIRCLE}/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: CIRCLE }) }
  );

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: USER });
  submitCheckIn.mockResolvedValue({ progress_percentage: 40, rank_change: 1, streak_days: 3, new_rank: 2 });
});

describe('POST /api/mobile/circles/[id]/check-in', () => {
  it('OLD SHAPE still checks in', async () => {
    const res = await post({ value: 88.4, mood_score: 4, energy_level: 3, note: 'ok' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ progress_percentage: 40, rank_change: 1, streak_days: 3, new_rank: 2 });
    expect(submitCheckIn).toHaveBeenCalledWith(USER, CIRCLE, {
      value: 88.4,
      mood_score: 4,
      energy_level: 3,
      note: 'ok',
    });
  });

  it('explicit nulls on optional fields are treated as not sent', async () => {
    const res = await post({ value: 88.4, mood_score: null, energy_level: null, note: null });

    expect(res.status).toBe(200);
    expect(submitCheckIn).toHaveBeenCalledWith(USER, CIRCLE, {
      value: 88.4,
      mood_score: undefined,
      energy_level: undefined,
      note: undefined,
    });
  });

  it('400 VALIDATION_ERROR keeps code + details and gains a readable message', async () => {
    const res = await post({ value: null });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toMatch(/^value: /);
    expect(submitCheckIn).not.toHaveBeenCalled();
  });

  it('still enforces the ranges', async () => {
    expect((await post({ value: -1 })).status).toBe(400);
    expect((await post({ value: 80, mood_score: 9 })).status).toBe(400);
  });
});

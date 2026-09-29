import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from '@/lib/services/__tests__/circle-fake-db';

const requireMobileAuth = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { POST } from '../route';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/mobile/share/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any
  );

beforeEach(() => {
  vi.clearAllMocks();
  setCircleDb(new CircleFakeDb());
  requireMobileAuth.mockResolvedValue({ id: USER });
});

describe('POST /api/mobile/share/cards', () => {
  it('mobile shape: the response is unchanged and decodes as the iOS ShareCard', async () => {
    const sent = { challenge_name: 'Daily Push-Ups', goal: '50 reps', rank: '3' };
    const res = await post({ card_type: 'challenge_complete', card_data: sent });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    // Core/Models/ShareCard.swift: id UUID, card_type enum, template_name String,
    // card_data [String: String], image_url String?, shared_count Int.
    expect(body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.data.card_type).toBe('challenge_complete');
    expect(body.data.template_name).toBe('challenge_victory');
    expect(body.data.card_data).toEqual(sent);
    expect(typeof body.data.image_url).toBe('string');
  });

  it('the rendered image gets numbers and camelCase keys', async () => {
    const body = await (
      await post({ card_type: 'milestone', card_data: { milestone_name: 'Week Warrior', days: '7', badge_emoji: '🔥' } })
    ).json();

    const data = new URL(body.data.image_url).searchParams.get('data')!;
    expect(JSON.parse(Buffer.from(data, 'base64').toString('utf-8'))).toMatchObject({
      milestoneName: 'Week Warrior',
      dayCount: 7,
      badgeEmoji: '🔥',
    });
  });

  it('web shape (camelCase numbers) still works', async () => {
    const sent = { milestoneName: '7-Day Warrior', dayCount: 7, badgeEmoji: '🔥', currentStreak: 7 };
    const res = await post({ card_type: 'milestone', card_data: sent });

    expect(res.status).toBe(201);
    expect((await res.json()).data.card_data).toEqual(sent);
  });

  it('400 VALIDATION_ERROR keeps code + details and gains a readable message', async () => {
    const res = await post({ card_type: 'selfie', card_data: {} });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toMatch(/^card_type: /);
  });

  it('card_data is still required', async () => {
    expect((await post({ card_type: 'milestone' })).status).toBe(400);
    expect((await post({ card_type: 'milestone', card_data: null })).status).toBe(400);
  });

  it('401 when unauthenticated', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    expect((await post({ card_type: 'milestone', card_data: {} })).status).toBe(401);
  });
});
